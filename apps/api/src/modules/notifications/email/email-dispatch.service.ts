import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { prisma } from '../../../database/client';
import {
  NOTIFICATION_EMAIL_JOB,
  NOTIFICATION_EMAIL_QUEUE,
  NotificationEmailJobData,
} from './email.constants';

/**
 * Post-commit email enqueue (Phase 8 spec §7.4).
 *
 * The notification row is the durable outbox: this service only enqueues for
 * rows that are still `PENDING`, applies the dispatch-time eligibility rules
 * with conditional `PENDING → SKIPPED` updates, and never lets an enqueue
 * failure affect the already-committed workflow transition.
 */
@Injectable()
export class EmailDispatchService {
  private readonly logger = new Logger(EmailDispatchService.name);

  constructor(
    @InjectQueue(NOTIFICATION_EMAIL_QUEUE)
    private readonly emailQueue: Queue<NotificationEmailJobData>,
  ) {}

  async dispatchEmailsSafely(notificationIds: string[]): Promise<void> {
    const uniqueIds = Array.from(new Set(notificationIds ?? []));
    if (uniqueIds.length === 0) {
      return;
    }

    try {
      const notifications = await prisma.notification.findMany({
        where: { id: { in: uniqueIds }, emailStatus: 'PENDING' },
        select: {
          id: true,
          type: true,
          recipientId: true,
          recipient: { select: { email: true, isActive: true } },
        },
      });

      for (const notification of notifications) {
        if (!this.isRecipientEligible(notification.recipient)) {
          const skipped = await this.markSkipped(notification.id);
          this.logger.log(
            `Notification ${notification.id} (${notification.type}) recipient ${notification.recipientId} ` +
              `is inactive or has no email; email marked ${skipped ? 'SKIPPED' : 'already resolved'}`,
          );
          continue;
        }

        try {
          await this.enqueue(notification.id);
          this.logger.log(
            `Enqueued email job for notification ${notification.id} (${notification.type}) recipient ${notification.recipientId}`,
          );
        } catch (error: unknown) {
          // Leave the row PENDING; the reconciliation sweep recovers it once
          // Redis is reachable. The transition is already committed.
          this.logger.error(
            `Failed to enqueue email job for notification ${notification.id}; ` +
              `row remains PENDING for reconciliation: ${this.errorMessage(error)}`,
          );
        }
      }
    } catch (error: unknown) {
      this.logger.error(
        `Email dispatch failed before enqueueing; rows remain PENDING for reconciliation: ${this.errorMessage(error)}`,
      );
    }
  }

  /** Adds one job with the deterministic notification-ID job identity. */
  async enqueue(notificationId: string): Promise<void> {
    await this.emailQueue.add(
      NOTIFICATION_EMAIL_JOB,
      { notificationId },
      { jobId: notificationId },
    );
  }

  /** Conditional `PENDING → SKIPPED`; returns false when already resolved. */
  private async markSkipped(notificationId: string): Promise<boolean> {
    const result = await prisma.notification.updateMany({
      where: { id: notificationId, emailStatus: 'PENDING' },
      data: { emailStatus: 'SKIPPED' },
    });
    return result.count > 0;
  }

  private isRecipientEligible(
    recipient: { email: string; isActive: boolean } | null | undefined,
  ): boolean {
    return Boolean(recipient?.isActive && recipient.email);
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
