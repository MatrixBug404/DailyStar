import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MinioStorageService } from './minio-storage.service';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  NoSuchKey,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

jest.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: jest.fn().mockImplementation(() => ({
      send: jest.fn(),
    })),
    PutObjectCommand: class {
      constructor(public input: any) {}
    },
    DeleteObjectCommand: class {
      constructor(public input: any) {}
    },
    HeadObjectCommand: class {
      constructor(public input: any) {}
    },
    GetObjectCommand: class {
      constructor(public input: any) {}
    },
    NoSuchKey: class NoSuchKey extends Error {},
  };
});
jest.mock('@aws-sdk/s3-request-presigner');

describe('MinioStorageService', () => {
  let service: MinioStorageService;
  let mockS3Client: jest.Mocked<S3Client>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MinioStorageService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'storage.endpoint') return 'http://localhost:9000';
              if (key === 'storage.bucket') return 'test-bucket';
              if (key === 'storage.region') return 'us-east-1';
              if (key === 'storage.accessKeyId') return 'test';
              if (key === 'storage.secretAccessKey') return 'test';
              return null;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<MinioStorageService>(MinioStorageService);
    // get access to the mocked internal client
    mockS3Client = (service as any).client;
    // mock send
    mockS3Client.send = jest.fn();
  });

  it('uploadObject sends PutObjectCommand', async () => {
    await service.uploadObject('test-key', Buffer.from('data'), 'image/jpeg', 4);
    expect(mockS3Client.send).toHaveBeenCalledWith(expect.any(PutObjectCommand));
    const commandArg = (mockS3Client.send as jest.Mock).mock.calls[0][0];
    expect(commandArg.input.ContentType).toBe('image/jpeg');
    expect(commandArg.input.ContentLength).toBe(4);
  });

  it('deleteObject sends DeleteObjectCommand', async () => {
    await service.deleteObject('test-key');
    expect(mockS3Client.send).toHaveBeenCalledWith(expect.any(DeleteObjectCommand));
  });

  it('generateSignedDownloadUrl sends GetObjectCommand with override headers', async () => {
    (getSignedUrl as jest.Mock).mockResolvedValue('http://signed-url');
    const url = await service.generateSignedDownloadUrl('a/b/c.jpg', 'image/jpeg', 3600);

    expect(getSignedUrl).toHaveBeenCalledWith(expect.any(Object), expect.any(GetObjectCommand), {
      expiresIn: 3600,
    });
    const commandArg = (getSignedUrl as jest.Mock).mock.calls[0][1];
    expect(commandArg.input.ResponseContentType).toBe('image/jpeg');
    expect(commandArg.input.ResponseContentDisposition).toBe('inline; filename="c.jpg"');
    expect(url).toBe('http://signed-url');
  });

  it('objectExists returns true if object exists', async () => {
    (mockS3Client.send as jest.Mock).mockResolvedValue({});
    const result = await service.objectExists('test-key');
    expect(result).toBe(true);
  });

  it('objectExists returns false if NoSuchKey thrown', async () => {
    (mockS3Client.send as jest.Mock).mockRejectedValue(
      new NoSuchKey({ $metadata: {}, message: 'test' }),
    );
    const result = await service.objectExists('test-key');
    expect(result).toBe(false);
  });

  it('objectExists re-throws other errors', async () => {
    (mockS3Client.send as jest.Mock).mockRejectedValue(new Error('AccessDenied'));
    await expect(service.objectExists('test-key')).rejects.toThrow('AccessDenied');
  });
});
