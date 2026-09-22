import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import sharp from 'sharp';
import { prisma } from '../../database/client';
import { STORAGE_SERVICE, StorageService } from './storage/storage.service.interface';
import { detectMimeType } from './utils/magic-bytes.util';
import { sanitizeFilename } from './utils/filename-sanitizer.util';
import { generateObjectKey } from './utils/object-key.util';
import { Media } from '../../database/generated/prisma';
import { UploadMediaResponseDto } from './dto/upload-media-response.dto';
import { SignedUrlResponseDto } from './dto/signed-url-response.dto';

@Injectable()
export class MediaService {
  constructor(
    private readonly configService: ConfigService,
    @Inject(STORAGE_SERVICE)
    private readonly storageService: StorageService,
  ) {}

  async processUpload(
    buffer: Buffer,
    originalname: string,
    user: any,
  ): Promise<UploadMediaResponseDto> {
    const { mimeType, ext } = await detectMimeType(buffer);

    let width: number | null = null;
    let height: number | null = null;
    try {
      const metadata = await sharp(buffer).metadata();
      width = metadata.width ?? null;
      height = metadata.height ?? null;
    } catch {
      throw new BadRequestException('INVALID_IMAGE_DATA');
    }

    const sha256Checksum = createHash('sha256').update(buffer).digest('hex');
    const sanitizedOriginalname = sanitizeFilename(originalname);
    const objectKey = generateObjectKey(user.sub, ext);
    const bucket = this.configService.get<string>('storage.bucket')!;
    const fileSizeBytes = BigInt(buffer.length);

    const record = await prisma.media.create({
      data: {
        status: 'UPLOADING',
        objectKey,
        bucket,
        originalFilename: sanitizedOriginalname,
        mimeType,
        mediaType: 'IMAGE',
        fileSizeBytes,
        sha256Checksum,
        width,
        height,
        uploadedById: user.sub,
        storageProvider: 'minio',
      },
    });

    try {
      await this.storageService.uploadObject(objectKey, buffer, mimeType, buffer.length);
    } catch (err) {
      await prisma.media.update({
        where: { id: record.id },
        data: { status: 'FAILED' },
      });
      throw new Error('UPLOAD_FAILED');
    }

    let updated;
    try {
      updated = await prisma.media.update({
        where: { id: record.id },
        data: { status: 'READY' },
      });
    } catch (err) {
      // Phase 4 DB-first/compensation spec:
      // If DB update to READY fails, the object in MinIO is orphaned.
      // We must compensate by attempting to delete the object.
      await this.storageService.deleteObject(objectKey).catch(() => {
        // Silently swallow delete errors during compensation to avoid masking the original DB error
      });
      // Optionally also set DB to FAILED if possible, but if the DB is down, this might also fail.
      // We will just throw the error. The stale UPLOADING row is handled by cron/expiry.
      throw new Error('READY_UPDATE_FAILED');
    }

    return this.toResponseDto(updated);
  }

  async findById(id: string, user: any): Promise<Media> {
    const STALE_THRESHOLD_MS = 30 * 60 * 1000;
    const media = await prisma.media.findUnique({ where: { id } });

    if (!media || media.deletedAt !== null) {
      throw new NotFoundException();
    }

    if (!user.permissions.includes('media.read.any') && media.uploadedById !== user.sub) {
      throw new NotFoundException();
    }

    if (
      media.status === 'UPLOADING' &&
      Date.now() - media.createdAt.getTime() > STALE_THRESHOLD_MS
    ) {
      throw new BadRequestException('MEDIA_NOT_READY');
    }

    return media;
  }

  async generateSignedUrl(
    id: string,
    user: any,
    expiresInSecondsOverride?: number,
  ): Promise<{ signedUrl: string; expiresAt: Date }> {
    const media = await this.findById(id, user);
    if (media.status !== 'READY') throw new BadRequestException('MEDIA_NOT_READY');

    const expiry =
      expiresInSecondsOverride ?? this.configService.get<number>('media.signedUrlExpirySeconds')!;

    const signedUrl = await this.storageService.generateSignedDownloadUrl(
      media.objectKey,
      media.mimeType,
      expiry,
    );
    return { signedUrl, expiresAt: new Date(Date.now() + expiry * 1000) };
  }

  async listOwn(user: any, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      prisma.media.findMany({
        where: { uploadedById: user.sub, status: 'READY', deletedAt: null },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.media.count({
        where: { uploadedById: user.sub, status: 'READY', deletedAt: null },
      }),
    ]);

    return {
      data: data.map((m) => this.toResponseDto(m)),
      total,
      page,
      limit,
    };
  }

  async softDelete(id: string, user: any): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<
        Array<{
          id: string;
          status: string;
          deletedAt: Date | null;
          uploadedById: string;
        }>
      >`
        SELECT id, status, "deletedAt", "uploadedById"
        FROM media
        WHERE id = ${id}
        FOR UPDATE
      `;

      if (!locked || locked.deletedAt !== null) throw new NotFoundException();

      if (!user.permissions.includes('media.delete.any') && locked.uploadedById !== user.sub) {
        throw new NotFoundException();
      }

      if (locked.status === 'UPLOADING') {
        throw new ConflictException('MEDIA_IN_USE');
      }

      const blockingArticle = await tx.article.findFirst({
        where: {
          coverMediaId: id,
          deletedAt: null,
          status: { notIn: ['ARCHIVED'] },
        },
        select: { id: true },
      });

      if (blockingArticle) {
        const canSeeIds =
          user.permissions.includes('media.delete.any') &&
          user.permissions.includes('article.read.any');
        throw new ConflictException({
          message: 'MEDIA_IN_USE',
          blockingArticleIds: canSeeIds ? [blockingArticle.id] : [],
        });
      }

      await tx.media.update({
        where: { id },
        data: { status: 'DELETED', deletedAt: new Date() },
      });
    });
  }

  async validateMediaForCover(mediaId: string, tx: any = prisma): Promise<void> {
    const [locked] = await tx.$queryRaw<
      Array<{
        id: string;
        status: string;
        deletedAt: Date | null;
      }>
    >`
      SELECT id, status, "deletedAt"
      FROM media
      WHERE id = ${mediaId}
      FOR UPDATE
    `;

    if (!locked || locked.deletedAt !== null || locked.status !== 'READY') {
      throw new NotFoundException('MEDIA_NOT_FOUND');
    }
  }

  async generateSignedUrlForCover(
    objectKey: string,
    mimeType: string,
  ): Promise<{ signedUrl: string; expiresAt: Date }> {
    const expiry = this.configService.get<number>('media.signedUrlExpirySeconds')!;
    const signedUrl = await this.storageService.generateSignedDownloadUrl(
      objectKey,
      mimeType,
      expiry,
    );
    return { signedUrl, expiresAt: new Date(Date.now() + expiry * 1000) };
  }

  public toResponseDto(media: Media): UploadMediaResponseDto {
    return {
      id: media.id,
      originalFilename: media.originalFilename,
      mimeType: media.mimeType,
      mediaType: media.mediaType,
      fileSizeBytes: String(media.fileSizeBytes),
      width: media.width,
      height: media.height,
      status: media.status,
      uploadedById: media.uploadedById,
      createdAt: media.createdAt,
    };
  }
}
