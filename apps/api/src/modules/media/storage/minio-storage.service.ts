import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  NoSuchKey,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageService } from './storage.service.interface';

@Injectable()
export class MinioStorageService implements StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly configService: ConfigService) {
    const endpoint = configService.get<string>('storage.endpoint');
    this.bucket = configService.get<string>('storage.bucket')!;
    this.client = new S3Client({
      endpoint,
      region: configService.get<string>('storage.region') ?? 'us-east-1',
      credentials: {
        accessKeyId: configService.get<string>('storage.accessKeyId')!,
        secretAccessKey: configService.get<string>('storage.secretAccessKey')!,
      },
      forcePathStyle: true, // Required for MinIO path-style addressing
    });
  }

  async uploadObject(
    key: string,
    buffer: Buffer,
    mimeType: string,
    sizeBytes: number,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        ContentLength: sizeBytes,
      }),
    );
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /**
   * Generates a signed GET URL that enforces:
   * - ResponseContentType: the server-validated MIME type (prevents MIME sniffing)
   * - ResponseContentDisposition: inline; filename="{uuid-segment}.ext"
   *   (images render inline; the original uploader filename is NOT echoed
   *   to avoid header injection)
   */
  async generateSignedDownloadUrl(
    key: string,
    mimeType: string,
    expiresInSeconds: number,
  ): Promise<string> {
    const keySegments = key.split('/');
    const filenameWithExt = keySegments[keySegments.length - 1];

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentType: mimeType,
      ResponseContentDisposition: `inline; filename="${filenameWithExt}"`,
    });

    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  /**
   * Returns true if the object exists.
   * Returns false only for genuine not-found (NoSuchKey) responses.
   * All other errors — 403 AccessDenied, network failures, 5xx — are re-thrown.
   */
  async objectExists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (err: unknown) {
      if (err instanceof NoSuchKey) return false;
      // Handle legacy 'NotFound' error name emitted by some S3-compatible servers
      if (
        typeof err === 'object' &&
        err !== null &&
        'name' in err &&
        (err as { name: string }).name === 'NotFound'
      ) {
        return false;
      }
      throw err; // AccessDenied, network, 5xx — propagate
    }
  }
}
