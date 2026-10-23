import { ConfigService } from '@nestjs/config';
import { createBullConnectionOptions } from './bull-connection';

function createConfigService(values: Record<string, unknown>): ConfigService {
  return {
    get: jest.fn((key: string, fallback?: unknown) => (key in values ? values[key] : fallback)),
  } as unknown as ConfigService;
}

describe('createBullConnectionOptions', () => {
  it('forwards the configured Redis password to BullMQ', () => {
    const configService = createConfigService({
      'redis.host': 'redis.internal',
      'redis.port': 6380,
      'redis.password': 'super-secret',
    });

    expect(createBullConnectionOptions(configService)).toEqual({
      connection: {
        host: 'redis.internal',
        port: 6380,
        password: 'super-secret',
      },
    });
  });

  it('omits the password when it is not configured (local unauthenticated Redis)', () => {
    const configService = createConfigService({
      'redis.host': 'localhost',
      'redis.port': 6379,
      'redis.password': undefined,
    });

    expect(createBullConnectionOptions(configService)).toEqual({
      connection: {
        host: 'localhost',
        port: 6379,
      },
    });
  });

  it('applies the existing host and port defaults', () => {
    const configService = createConfigService({});

    expect(createBullConnectionOptions(configService)).toEqual({
      connection: {
        host: 'localhost',
        port: 6379,
      },
    });
  });
});
