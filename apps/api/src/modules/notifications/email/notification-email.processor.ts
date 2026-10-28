import { Inject } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { prisma } from '../../../database/client';
import { NOTIFICATION_EMAIL_QUEUE, NotificationEmailJobData } from './email.constants';
import { EMAIL_PROVIDER, EmailProvider } from './email-provider.interface';

const EMAIL_SUBJECT_PREFIX = '[DailyStar]';

/**
 * BullMQ worker for `notification-email` (Phase 8 spec §8.1).
 *
 * Delivery-state writes are always compare-and-set from `PENDING`, so a stale
 * worker can never overwrite a terminal state written by the reconciler.
 */
@Processor(NOTIFICATION_EMAIL_QUEUE)
export class NotificationEmailProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationEmailProcessor.name);

  constructor(
    @Inject(EMAIL_PROVIDER)
    private readonly emailProvider: EmailProvider,
  ) {
    super();
  }

  async process(job: Job<NotificationEmailJobData>): Promise<void> {
    const notificationId = job?.data?.notificationId;
    if (!notificationId) {
      this.logger.warn('Received notification-email job without a notificationId; completing');
      return;
    }

    const notification = await prisma.notification.findUnique({
      where: { id: notificationId },
      include: {
        recipient: { select: { email: true, isActive: true } },
      },
    });

    if (!notification) {
      this.logger.warn(`Notification ${notificationId} no longer exists; completing job`);
      return;
    }

    if (notification.emailStatus !== 'PENDING') {
      this.logger.log(
        `Notification ${notification.id} is already ${notification.emailStatus}; skipping delivery`,
      );
      return;
    }

    const recipient = notification.recipient;
    if (!recipient?.isActive || !recipient.email) {
      const skipped = await this.markSkipped(notification.id, recipient);
      this.logger.log(
        `Notification ${notification.id} recipient ${notification.recipientId} is inactive or has no email; ` +
          `email marked ${skipped ? 'SKIPPED' : 'already resolved'}`,
      );
      return;
    }

    try {
      await this.emailProvider.send({
        to: recipient.email,
        subject: `${EMAIL_SUBJECT_PREFIX} ${notification.title}`,
        text: notification.body,
        notificationId: notification.id,
      });
    } catch (error: unknown) {
      const message = this.errorMessage(error);
      const recorded = await prisma.notification.updateMany({
        where: { id: notification.id, emailStatus: 'PENDING' },
        data: {
          emailAttempts: { increment: 1 },
          emailLastError: message,
        },
      });

      if (recorded.count === 0) {
        this.logger.log(
          `Notification ${notification.id} was resolved by another actor during delivery; not retrying`,
        );
        return;
      }

      this.logger.error(
        `Email delivery failed for notification ${notification.id} (${notification.type}) ` +
          `recipient ${notification.recipientId}: ${message}`,
      );
      // Rethrow so BullMQ applies exponential backoff/retry.
      throw error;
    }

    const sent = await prisma.notification.updateMany({
      where: { id: notification.id, emailStatus: 'PENDING' },
      data: {
        emailStatus: 'SENT',
        emailSentAt: new Date(),
        emailAttempts: { increment: 1 },
      },
    });

    if (sent.count === 0) {
      this.logger.warn(
        `Notification ${notification.id} reached a terminal state before the SENT update; ` +
          'delivery evidence was not persisted and the existing terminal state is preserved',
      );
      return;
    }

    this.logger.log(
      `Email delivered for notification ${notification.id} (${notification.type}) recipient ${notification.recipientId}`,
    );
  }

  private async markSkipped(
    notificationId: string,
    recipient: { email: string; isActive: boolean } | null | undefined,
  ): Promise<boolean> {
    const result = await prisma.notification.updateMany({
      where: { id: notificationId, emailStatus: 'PENDING' },
      data: { emailStatus: 'SKIPPED' },
    });
    if (result.count === 0) {
      this.logger.log(
        `Notification ${notificationId} was already resolved; recipient eligibility ` +
          `(active=${recipient?.isActive ?? false}, hasEmail=${Boolean(recipient?.email)}) not re-applied`,
      );
    }
    return result.count > 0;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
