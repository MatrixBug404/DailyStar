import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MediaService } from './media.service';
import { STORAGE_SERVICE } from './storage/storage.service.interface';
import { detectMimeType } from './utils/magic-bytes.util';
import { prisma } from '../../database/client';
import * as sharp from 'sharp';

jest.mock('./utils/magic-bytes.util');
jest.mock('sharp');
jest.mock('../../database/client', () => ({
  prisma: {
    media: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    article: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn((cb) =>
      cb({
        $queryRaw: jest.fn(),
        media: { update: jest.fn() },
        article: { findFirst: jest.fn() },
      }),
    ),
    $queryRaw: jest.fn(),
  },
}));

describe('MediaService', () => {
  let service: MediaService;
  let storageServiceMock: any;

  beforeEach(async () => {
    jest.clearAllMocks();

    storageServiceMock = {
      uploadObject: jest.fn(),
      generateSignedDownloadUrl: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('test-bucket'),
          },
        },
        {
          provide: STORAGE_SERVICE,
          useValue: storageServiceMock,
        },
      ],
    }).compile();

    service = module.get<MediaService>(MediaService);
  });

  describe('processUpload', () => {
    const mockUser = { sub: 'user-id', permissions: [] } as any;

    it('uploads and creates READY record', async () => {
      (detectMimeType as jest.Mock).mockResolvedValue({ mimeType: 'image/jpeg', ext: '.jpg' });
      const sharpMock = { metadata: jest.fn().mockResolvedValue({ width: 100, height: 100 }) };
      (sharp as unknown as jest.Mock).mockReturnValue(sharpMock);

      const mockRecord = { id: 'media-1', fileSizeBytes: BigInt(4) };
      (prisma.media.create as jest.Mock).mockResolvedValue(mockRecord);
      (prisma.media.update as jest.Mock).mockResolvedValue({ ...mockRecord, status: 'READY' });

      const result = await service.processUpload(Buffer.from('test'), 'test.jpg', mockUser);
      expect(result.status).toBe('READY');
      expect(storageServiceMock.uploadObject).toHaveBeenCalled();
    });

    it('throws UPLOAD_FAILED and sets status to FAILED if storage fails', async () => {
      (detectMimeType as jest.Mock).mockResolvedValue({ mimeType: 'image/jpeg', ext: '.jpg' });
      const sharpMock = { metadata: jest.fn().mockResolvedValue({ width: 100, height: 100 }) };
      (sharp as unknown as jest.Mock).mockReturnValue(sharpMock);

      const mockRecord = { id: 'media-1', fileSizeBytes: BigInt(4) };
      (prisma.media.create as jest.Mock).mockResolvedValue(mockRecord);

      storageServiceMock.uploadObject.mockRejectedValue(new Error('MinIO down'));

      await expect(
        service.processUpload(Buffer.from('test'), 'test.jpg', mockUser),
      ).rejects.toThrow('UPLOAD_FAILED');

      expect(prisma.media.update).toHaveBeenCalledWith({
        where: { id: 'media-1' },
        data: { status: 'FAILED' },
      });
    });

    it('throws READY_UPDATE_FAILED and compensates if DB update to READY fails', async () => {
      (detectMimeType as jest.Mock).mockResolvedValue({ mimeType: 'image/jpeg', ext: '.jpg' });
      const sharpMock = { metadata: jest.fn().mockResolvedValue({ width: 100, height: 100 }) };
      (sharp as unknown as jest.Mock).mockReturnValue(sharpMock);

      const mockRecord = { id: 'media-1', fileSizeBytes: BigInt(4) };
      (prisma.media.create as jest.Mock).mockResolvedValue(mockRecord);

      storageServiceMock.uploadObject.mockResolvedValue();
      storageServiceMock.deleteObject = jest.fn().mockResolvedValue(undefined);

      // Make the READY update fail
      (prisma.media.update as jest.Mock).mockRejectedValueOnce(new Error('DB down'));

      await expect(
        service.processUpload(Buffer.from('test'), 'test.jpg', mockUser),
      ).rejects.toThrow('READY_UPDATE_FAILED');

      expect(storageServiceMock.deleteObject).toHaveBeenCalled();
    });
  });

  describe('findById (IDOR protection)', () => {
    it('returns media if owned', async () => {
      const media = { id: 'm1', uploadedById: 'u1', deletedAt: null, status: 'READY' };
      (prisma.media.findUnique as jest.Mock).mockResolvedValue(media);
      const result = await service.findById('m1', {
        sub: 'u1',
        permissions: ['media.read.own'],
      } as any);
      expect(result).toEqual(media);
    });

    it('throws 404 (IDOR) for other user media without read.any', async () => {
      const media = { id: 'm1', uploadedById: 'u1', deletedAt: null, status: 'READY' };
      (prisma.media.findUnique as jest.Mock).mockResolvedValue(media);
      await expect(
        service.findById('m1', { sub: 'u2', permissions: ['media.read.own'] } as any),
      ).rejects.toThrow('Not Found'); // 404
    });

    it('throws 404 (IDOR, not 400) for other user stale UPLOADING media', async () => {
      const media = {
        id: 'm1',
        uploadedById: 'u1',
        deletedAt: null,
        status: 'UPLOADING',
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
      };
      (prisma.media.findUnique as jest.Mock).mockResolvedValue(media);
      await expect(
        service.findById('m1', { sub: 'u2', permissions: ['media.read.own'] } as any),
      ).rejects.toThrow('Not Found'); // 404, proving IDOR prevents leak of stale media
    });

    it('throws 400 for own stale UPLOADING media', async () => {
      const media = {
        id: 'm1',
        uploadedById: 'u1',
        deletedAt: null,
        status: 'UPLOADING',
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
      };
      (prisma.media.findUnique as jest.Mock).mockResolvedValue(media);
      await expect(
        service.findById('m1', { sub: 'u1', permissions: ['media.read.own'] } as any),
      ).rejects.toThrow('MEDIA_NOT_READY'); // 400
    });
  });

  describe('softDelete', () => {
    const buildTx = (
      overrides: Partial<{
        media: { id: string; status: string; deletedAt: Date | null; uploadedById: string };
        blockingArticle: { id: string } | null;
      }> = {},
    ) => {
      const mediaRow = overrides.media ?? {
        id: 'm1',
        status: 'READY',
        deletedAt: null,
        uploadedById: 'u1',
      };
      return {
        $queryRaw: jest.fn().mockResolvedValue([mediaRow]),
        article: { findFirst: jest.fn().mockResolvedValue(overrides.blockingArticle ?? null) },
        media: { update: jest.fn() },
      };
    };

    it('sets status to DELETED and deletedAt when owner deletes own READY media', async () => {
      const mockTx = buildTx();
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb) => cb(mockTx));

      await service.softDelete('m1', { sub: 'u1', permissions: ['media.delete.own'] } as any);

      expect(mockTx.media.update).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: { status: 'DELETED', deletedAt: expect.any(Date) },
      });
    });

    it('throws 404 (IDOR) when another user without delete.any tries to delete', async () => {
      const mockTx = buildTx();
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb) => cb(mockTx));

      await expect(
        service.softDelete('m1', { sub: 'u2', permissions: ['media.delete.own'] } as any),
      ).rejects.toThrow('Not Found');

      expect(mockTx.media.update).not.toHaveBeenCalled();
    });

    it('throws ConflictException MEDIA_IN_USE when media is still UPLOADING', async () => {
      const mockTx = buildTx({
        media: { id: 'm1', status: 'UPLOADING', deletedAt: null, uploadedById: 'u1' },
      });
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb) => cb(mockTx));

      await expect(
        service.softDelete('m1', { sub: 'u1', permissions: ['media.delete.own'] } as any),
      ).rejects.toThrow('MEDIA_IN_USE');

      expect(mockTx.media.update).not.toHaveBeenCalled();
    });

    it('throws ConflictException MEDIA_IN_USE when referenced by a live non-archived article', async () => {
      const mockTx = buildTx({
        blockingArticle: { id: 'article-1' },
      });
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb) => cb(mockTx));

      await expect(
        service.softDelete('m1', { sub: 'u1', permissions: ['media.delete.own'] } as any),
      ).rejects.toThrow('MEDIA_IN_USE');

      expect(mockTx.media.update).not.toHaveBeenCalled();
    });

    it('succeeds when media is only referenced by archived article(s)', async () => {
      // findFirst with notIn: ['ARCHIVED'] returns null → no blocking article
      const mockTx = buildTx({ blockingArticle: null });
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb) => cb(mockTx));

      await service.softDelete('m1', { sub: 'u1', permissions: ['media.delete.own'] } as any);

      expect(mockTx.media.update).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: { status: 'DELETED', deletedAt: expect.any(Date) },
      });
    });
  });
});
