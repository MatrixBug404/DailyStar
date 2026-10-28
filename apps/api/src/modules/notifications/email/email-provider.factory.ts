import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EMAIL_PROVIDER, EmailProvider } from './email-provider.interface';
import { LogEmailProvider } from './log-email.provider';
import { PostmarkEmailProvider } from './postmark-email.provider';

const DEFAULT_EMAIL_FROM = 'DailyStar <notifications@dailystar.local>';

/**
 * Selects and constructs the email provider at module initialisation.
 *
 * Invalid configuration fails application startup with an explicit message
 * (Phase 8 AC-12). The Postmark token is read here only and is never logged.
 */
export function createEmailProvider(
  configService: ConfigService,
  logger: Logger = new Logger('EmailProviderFactory'),
): EmailProvider {
  const provider = configService.get<string>('notifications.email.provider', 'log');
  const nodeEnv = configService.get<string>('nodeEnv', 'local');

  if (provider === 'log') {
    if (nodeEnv === 'production') {
      logger.warn(
        'EMAIL_PROVIDER=log — outbound email delivery is DISABLED in production. ' +
          'Notification emails will only be written to the application log.',
      );
    }
    return new LogEmailProvider();
  }

  if (provider === 'postmark') {
    const token = configService.get<string>('notifications.email.postmarkServerToken', '');
    if (!token) {
      throw new Error(
        'EMAIL_PROVIDER=postmark requires a non-empty POSTMARK_SERVER_TOKEN environment variable',
      );
    }

    const from = configService.get<string>('notifications.email.from', DEFAULT_EMAIL_FROM);
    return new PostmarkEmailProvider(token, from || DEFAULT_EMAIL_FROM);
  }

  throw new Error(`Invalid EMAIL_PROVIDER "${provider}". Supported values: log, postmark.`);
}

export const emailProviderProvider: Provider = {
  provide: EMAIL_PROVIDER,
  inject: [ConfigService],
  useFactory: (configService: ConfigService) => createEmailProvider(configService),
};
