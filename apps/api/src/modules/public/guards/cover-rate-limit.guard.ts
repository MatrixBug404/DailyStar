import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RateLimiterRedisService } from './rate-limiter.redis.service';
import * as crypto from 'crypto';

@Injectable()
export class CoverRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(CoverRateLimitGuard.name);
  private readonly secret: string;

  constructor(
    private readonly rateLimiter: RateLimiterRedisService,
    private readonly configService: ConfigService,
  ) {
    this.secret = this.configService.get<string>('security.coverProxyTrustSecret')!;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    let clientIp = request.ip || 'unknown';

    const headerIp = request.header('X-DailyStar-Client-IP');
    const headerSig = request.header('X-DailyStar-Client-IP-Signature');

    if (headerIp && headerSig) {
      try {
        const normalizedIp = headerIp.trim();
        const expectedSig = crypto
          .createHmac('sha256', this.secret)
          .update(normalizedIp)
          .digest('hex');

        // Safely convert both to buffers, catching malformed hex
        let expectedBuffer: Buffer;
        let providedBuffer: Buffer;
        try {
          expectedBuffer = Buffer.from(expectedSig, 'hex');
          providedBuffer = Buffer.from(headerSig.trim(), 'hex');
        } catch (e) {
          throw new Error('Malformed hex');
        }

        if (
          expectedBuffer.length === providedBuffer.length &&
          crypto.timingSafeEqual(expectedBuffer, providedBuffer)
        ) {
          // Signature matches, use propagated IP
          clientIp = normalizedIp;
        } else {
          this.logger.warn(`Invalid client IP signature for IP: ${normalizedIp}`);
        }
      } catch (error) {
        // Any error during validation -> fallback to req.ip
        this.logger.warn('Failed to validate client IP signature, falling back to req.ip', error);
      }
    }

    // Attach for controller usage
    request.clientIpForRateLimit = clientIp;

    const allowed = await this.rateLimiter.checkRateLimit(clientIp);

    if (!allowed) {
      response.set('Retry-After', '60');
      throw new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS);
    }

    return true;
  }
}
