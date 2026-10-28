import { Injectable, Logger } from '@nestjs/common';
import { EmailMessage, EmailProvider } from './email-provider.interface';

/**
 * Local / test / CI email provider (Phase 8 spec §9.2).
 *
 * Logs only delivery metadata — never the message body. Resolves successfully
 * so the worker records a `SENT` notification without any network I/O.
 */
@Injectable()
export class LogEmailProvider implements EmailProvider {
  private readonly logger = new Logger(LogEmailProvider.name);

  async send(message: EmailMessage): Promise<void> {
    this.logger.log(
      `[email:log] notificationId=${message.notificationId ?? 'n/a'} to=${message.to} subject="${message.subject}"`,
    );
  }
}
