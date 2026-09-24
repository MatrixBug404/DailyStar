import { Test, TestingModule } from '@nestjs/testing';
import { CoverRateLimitGuard } from './cover-rate-limit.guard';
import { RateLimiterRedisService } from './rate-limiter.redis.service';
import { ConfigService } from '@nestjs/config';
import { ExecutionContext, HttpException } from '@nestjs/common';
import * as crypto from 'crypto';

describe('CoverRateLimitGuard', () => {
  let guard: CoverRateLimitGuard;
  let rateLimiter: RateLimiterRedisService;

  const mockSecret = 'a'.repeat(32);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CoverRateLimitGuard,
        {
          provide: RateLimiterRedisService,
          useValue: { checkRateLimit: jest.fn().mockResolvedValue(true) },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue(mockSecret),
          },
        },
      ],
    }).compile();

    guard = module.get<CoverRateLimitGuard>(CoverRateLimitGuard);
    rateLimiter = module.get<RateLimiterRedisService>(RateLimiterRedisService);
  });

  const createMockContext = (ip: string, headers: Record<string, string>) => {
    const request = {
      ip,
      header: (name: string) => headers[name],
      clientIpForRateLimit: '',
    };
    const response = {
      set: jest.fn(),
    };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;
  };

  it('PU-19: valid signature -> propagated IP', async () => {
    const propagatedIp = '1.2.3.4';
    const signature = crypto.createHmac('sha256', mockSecret).update(propagatedIp).digest('hex');
    const ctx = createMockContext('10.0.0.1', {
      'X-DailyStar-Client-IP': propagatedIp,
      'X-DailyStar-Client-IP-Signature': signature,
    });

    await guard.canActivate(ctx);
    const req = ctx.switchToHttp().getRequest() as any;
    expect(req.clientIpForRateLimit).toBe(propagatedIp);
    expect(rateLimiter.checkRateLimit).toHaveBeenCalledWith(propagatedIp);
  });

  it('PU-20: invalid signature -> req.ip', async () => {
    const propagatedIp = '1.2.3.4';
    const signature = 'invalidhex';
    const ctx = createMockContext('10.0.0.1', {
      'X-DailyStar-Client-IP': propagatedIp,
      'X-DailyStar-Client-IP-Signature': signature,
    });

    await guard.canActivate(ctx);
    const req = ctx.switchToHttp().getRequest() as any;
    expect(req.clientIpForRateLimit).toBe('10.0.0.1');
    expect(rateLimiter.checkRateLimit).toHaveBeenCalledWith('10.0.0.1');
  });

  it('PU-21: malformed/invalid hex -> req.ip without exception', async () => {
    const propagatedIp = '1.2.3.4';
    const signature = 'nothex';
    const ctx = createMockContext('10.0.0.1', {
      'X-DailyStar-Client-IP': propagatedIp,
      'X-DailyStar-Client-IP-Signature': signature,
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    const req = ctx.switchToHttp().getRequest() as any;
    expect(req.clientIpForRateLimit).toBe('10.0.0.1');
  });

  it('PU-22: missing headers -> req.ip', async () => {
    const ctx = createMockContext('10.0.0.1', {});
    await guard.canActivate(ctx);
    const req = ctx.switchToHttp().getRequest() as any;
    expect(req.clientIpForRateLimit).toBe('10.0.0.1');
  });

  it('PU-23: denied -> 429 and Retry-After exactly 60', async () => {
    (rateLimiter.checkRateLimit as jest.Mock).mockResolvedValue(false);
    const ctx = createMockContext('10.0.0.1', {});

    await expect(guard.canActivate(ctx)).rejects.toThrow(HttpException);
    const res = ctx.switchToHttp().getResponse() as any;
    expect(res.set).toHaveBeenCalledWith('Retry-After', '60');
  });
});
