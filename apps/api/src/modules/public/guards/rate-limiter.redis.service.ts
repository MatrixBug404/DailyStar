import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import * as crypto from 'crypto';

@Injectable()
export class RateLimiterRedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RateLimiterRedisService.name);
  private redisClient!: Redis;
  private readonly limit = 100;
  private readonly windowMs = 60000; // 60 seconds

  // Lua script for atomic sliding window rate limiting
  private readonly slideWindowScript = `
    local key = KEYS[1]
    local now = tonumber(ARGV[1])
    local window = tonumber(ARGV[2])
    local limit = tonumber(ARGV[3])
    local member = ARGV[4]

    -- Remove stale entries
    redis.call('ZREMRANGEBYSCORE', key, 0, now - window)

    -- Count current entries
    local count = redis.call('ZCARD', key)

    if count >= limit then
      return 0
    end

    -- Add current request
    redis.call('ZADD', key, now, member)

    -- Set expiry to window duration
    redis.call('PEXPIRE', key, window)

    return 1
  `;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const host = this.configService.get<string>('redis.host') ?? 'localhost';
    const port = this.configService.get<number>('redis.port') ?? 6379;
    const password = this.configService.get<string>('redis.password');

    this.redisClient = new Redis({
      host,
      port,
      password,
      retryStrategy: (times) => {
        return Math.min(times * 50, 2000);
      },
    });

    this.redisClient.on('error', (err) => {
      this.logger.error('Redis connection error:', err);
    });
  }

  onModuleDestroy() {
    this.redisClient.disconnect();
  }

  /**
   * Checks if the given IP has exceeded the rate limit.
   * Uses a true sliding window algorithm backed by a Redis sorted set.
   * If Redis is unavailable, it logs a warning and fails open (returns true).
   */
  async checkRateLimit(clientIp: string): Promise<boolean> {
    const key = `rl:cover:${clientIp}`;
    const now = Date.now();
    const member = crypto.randomUUID();

    try {
      if (this.redisClient.status !== 'ready') {
        this.logger.warn('Redis is not ready. Failing open for rate limiter.');
        return true;
      }

      // Execute Lua script
      // eval(script, numkeys, key1, ..., arg1, ...)
      const result = await this.redisClient.eval(
        this.slideWindowScript,
        1,
        key,
        now,
        this.windowMs,
        this.limit,
        member
      );

      return result === 1;
    } catch (error) {
      this.logger.error('Error executing rate limiter Lua script, failing open', error);
      return true;
    }
  }
}
