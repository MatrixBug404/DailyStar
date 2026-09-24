import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RateLimiterRedisService } from './rate-limiter.redis.service';
import Redis from 'ioredis';
import * as crypto from 'crypto';

jest.mock('ioredis');

describe('RateLimiterRedisService', () => {
  let service: RateLimiterRedisService;
  let mockRedisClient: jest.Mocked<Redis>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RateLimiterRedisService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue(null),
          },
        },
      ],
    }).compile();

    service = module.get<RateLimiterRedisService>(RateLimiterRedisService);
    service.onModuleInit();
    mockRedisClient = (service as any).redisClient;
    mockRedisClient.status = 'ready';
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('PU-15: Should allow 100 requests', async () => {
    mockRedisClient.eval = jest.fn().mockResolvedValue(1);
    const result = await service.checkRateLimit('127.0.0.1');
    expect(result).toBe(true);
    expect(mockRedisClient.eval).toHaveBeenCalled();
  });

  it('PU-16: Should deny 101st request', async () => {
    mockRedisClient.eval = jest.fn().mockResolvedValue(0);
    const result = await service.checkRateLimit('127.0.0.1');
    expect(result).toBe(false);
  });

  it('PU-17: Should fail open on Redis failure', async () => {
    mockRedisClient.eval = jest.fn().mockRejectedValue(new Error('Redis error'));
    const result = await service.checkRateLimit('127.0.0.1');
    expect(result).toBe(true);
  });

  it('PU-18: Should fail open if Redis status is not ready', async () => {
    mockRedisClient.status = 'connecting';
    const result = await service.checkRateLimit('127.0.0.1');
    expect(result).toBe(true);
    expect(mockRedisClient.eval).not.toHaveBeenCalled();
  });
});
