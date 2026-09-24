import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';
import { SearchModule } from '../search/search.module';
import { MediaModule } from '../media/media.module';
import { RateLimiterRedisService } from './guards/rate-limiter.redis.service';
import { CoverRateLimitGuard } from './guards/cover-rate-limit.guard';

@Module({
  imports: [ConfigModule, SearchModule, MediaModule],
  controllers: [PublicController],
  providers: [PublicService, RateLimiterRedisService, CoverRateLimitGuard],
})
export class PublicModule {}
