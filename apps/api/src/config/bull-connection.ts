import { ConfigService } from '@nestjs/config';

/**
 * Builds the BullMQ connection options from application configuration.
 *
 * The optional Redis password is forwarded only when configured, so an
 * unauthenticated local Redis (empty or missing REDIS_PASSWORD) keeps working.
 * The password value is never logged here or by BullMQ's connection factory.
 */
export function createBullConnectionOptions(configService: ConfigService) {
  const password = configService.get<string>('redis.password');

  return {
    connection: {
      host: configService.get<string>('redis.host', 'localhost'),
      port: configService.get<number>('redis.port', 6379),
      ...(password ? { password } : {}),
    },
  };
}
