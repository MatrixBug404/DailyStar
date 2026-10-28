import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createEmailProvider } from './email-provider.factory';
import { LogEmailProvider } from './log-email.provider';
import { PostmarkEmailProvider } from './postmark-email.provider';

function buildConfig(values: Record<string, unknown>): ConfigService {
  return {
    get: jest.fn((key: string, fallback?: unknown) => (key in values ? values[key] : fallback)),
  } as unknown as ConfigService;
}

function buildLogger(): Logger {
  return { warn: jest.fn() } as unknown as Logger;
}

describe('createEmailProvider', () => {
  it('defaults to the log provider', () => {
    const provider = createEmailProvider(buildConfig({}), buildLogger());
    expect(provider).toBeInstanceOf(LogEmailProvider);
  });

  it('warns prominently when production runs with the log provider', () => {
    const logger = buildLogger();
    createEmailProvider(
      buildConfig({ 'notifications.email.provider': 'log', nodeEnv: 'production' }),
      logger,
    );

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('DISABLED in production'));
  });

  it('builds the Postmark provider when a token is configured', () => {
    const provider = createEmailProvider(
      buildConfig({
        'notifications.email.provider': 'postmark',
        'notifications.email.postmarkServerToken': 'pm-token',
        'notifications.email.from': 'News <news@dailystar.local>',
      }),
      buildLogger(),
    );

    expect(provider).toBeInstanceOf(PostmarkEmailProvider);
  });

  it('fails startup with a clear message when postmark has no token', () => {
    expect(() =>
      createEmailProvider(
        buildConfig({
          'notifications.email.provider': 'postmark',
          'notifications.email.postmarkServerToken': '',
        }),
        buildLogger(),
      ),
    ).toThrow('EMAIL_PROVIDER=postmark requires a non-empty POSTMARK_SERVER_TOKEN');
  });

  it('fails startup for an unsupported provider', () => {
    expect(() =>
      createEmailProvider(
        buildConfig({ 'notifications.email.provider': 'sendgrid' }),
        buildLogger(),
      ),
    ).toThrow('Invalid EMAIL_PROVIDER "sendgrid"');
  });
});
