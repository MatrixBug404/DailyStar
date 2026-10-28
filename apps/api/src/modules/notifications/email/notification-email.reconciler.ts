import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Job, Queue } from 'bullmq';
import { prisma } from '../../../database/client';
import {
  NOTIFICATION_EMAIL_JOB,
  NOTIFICATION_EMAIL_QUEUE,
  NotificationEmailJobData,
} from './email.constants';

interface ReconcilableNotification {
  id: string;
  type: string;
  recipientId: string;
  emailAttempts: number;
  emailLastError: string | null;
  recipient: { email: string; isActive: boolean } | null;
}

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_STALE_MINUTES = 10;

/**
 * Reconciliation sweep for notification email delivery (Phase 8 spec §8.2).
 *
 * Read database state first, inspect Redis second, and never hold a database
 * transaction or row lock across Redis/provider I/O. Every delivery-state
 * write is a compare-and-set from `PENDING`; terminal states are immutable.
 * This sweep is the sole authority for `FAILED` after an eligible delivery
 * exhausts its retry/recovery policy.
 */
@Injectable()
export class NotificationEmailReconciler {
  private readonly logger = new Logger(NotificationEmailReconciler.name);

  constructor(
    @InjectQueue(NOTIFICATION_EMAIL_QUEUE)
    private readonly emailQueue: Queue<NotificationEmailJobData>,
    private readonly configService: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async reconcile(): Promise<void> {
    if (!this.enabled) {
      this.logger.debug('Email reconciliation disabled (EMAIL_RECONCILE_ENABLED=false)');
      return;
    }

    let batch: ReconcilableNotification[];
    try {
      batch = await this.findStalePending();
    } catch (error: unknown) {
      this.logger.error(
        `Failed to load stale PENDING notification emails: ${this.errorMessage(error)}`,
      );
      return;
    }

    if (batch.length === 0) {
      return;
    }

    this.logger.log(`Reconciling ${batch.length} stale PENDING notification email(s)`);

    for (const notification of batch) {
      try {
        await this.reconcileNotification(notification);
      } catch (error: unknown) {
        // One unexpected row failure must not abort the rest of the batch.
        this.logger.error(
          `Failed to reconcile notification ${notification.id}: ${this.errorMessage(error)}`,
        );
      }
    }
  }

  private async findStalePending(): Promise<ReconcilableNotification[]> {
    const staleBefore = new Date(Date.now() - this.staleMinutes * 60_000);

    return prisma.notification.findMany({
      where: {
        emailStatus: 'PENDING',
        createdAt: { lt: staleBefore },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: this.batchSize,
      select: {
        id: true,
        type: true,
        recipientId: true,
        emailAttempts: true,
        emailLastError: true,
        recipient: { select: { email: true, isActive: true } },
      },
    });
  }

  private async reconcileNotification(notification: ReconcilableNotification): Promise<void> {
    let job: Job<NotificationEmailJobData> | null;
    try {
      job = (await this.emailQueue.getJob(notification.id)) ?? null;
    } catch (error: unknown) {
      // Redis unavailable or inspection inconclusive: leave PENDING and do not
      // increment attempts; the next sweep retries.
      this.logger.error(
        `Redis unavailable while reconciling notification ${notification.id}; leaving PENDING: ${this.errorMessage(error)}`,
      );
      return;
    }

    if (!job) {
      await this.handleMissingJob(notification);
      return;
    }

    let jobState: string;
    try {
      jobState = await job.getState();
    } catch (error: unknown) {
      this.logger.error(
        `Failed to inspect job state for notification ${notification.id}; leaving PENDING: ${this.errorMessage(error)}`,
      );
      return;
    }

    if (jobState === 'completed') {
      // Completed delivery evidence wins over current recipient eligibility,
      // but only upgrades a PENDING row to SENT — never resend.
      await this.markSent(notification.id);
      return;
    }

    if (jobState === 'failed') {
      const maxAttempts = job.opts?.attempts ?? this.maxAttempts;
      if (job.attemptsMade < maxAttempts) {
        // A retrying job is still live; the worker owns the pre-send decision.
        this.logger.debug(
          `Job ${notification.id} failed with retries remaining (${job.attemptsMade}/${maxAttempts}); leaving PENDING`,
        );
        return;
      }

      await this.handleExhaustedJob(notification, job);
      return;
    }

    if (jobState === 'waiting' || jobState === 'delayed' || jobState === 'active') {
      // Live jobs are not delivery evidence; never reset, remove or interrupt.
      this.logger.debug(`Job ${notification.id} is ${jobState}; leaving PENDING and job untouched`);
      return;
    }

    // Any other/unknown observation is inconclusive: no state mutation.
    this.logger.warn(
      `Job ${notification.id} is in an unrecognised state "${jobState}"; leaving PENDING`,
    );
  }

  private async handleExhaustedJob(
    notification: ReconcilableNotification,
    job: Job<NotificationEmailJobData>,
  ): Promise<void> {
    if (!this.isRecipientEligible(notification.recipient)) {
      await this.markSkipped(notification.id, 'exhausted delivery for ineligible recipient');
      return;
    }

    const lastError =
      job.failedReason || notification.emailLastError || 'Email delivery retries exhausted';
    const updated = await this.transitionFromPending(notification.id, {
      emailStatus: 'FAILED',
      emailLastError: lastError,
    });
    this.logCompletion(notification, 'FAILED', updated);
  }

  private async handleMissingJob(notification: ReconcilableNotification): Promise<void> {
    if (!this.isRecipientEligible(notification.recipient)) {
      await this.markSkipped(notification.id, 'missing job for ineligible recipient');
      return;
    }

    if (notification.emailAttempts >= this.maxAttempts) {
      const updated = await this.transitionFromPending(notification.id, {
        emailStatus: 'FAILED',
        emailLastError: notification.emailLastError ?? 'Email delivery attempts exhausted',
      });
      this.logCompletion(notification, 'FAILED', updated);
      return;
    }

    await this.enqueueMissingJob(notification);
  }

  /**
   * Crash-recovery path: re-enqueue a missing job with the same deterministic
   * ID. A retained *failed* job (observed after a raced add) is removed only
   * after verifying removal, then one re-add is attempted; a live or completed
   * blocking job is left untouched and the row is deferred to the next sweep.
   */
  private async enqueueMissingJob(notification: ReconcilableNotification): Promise<void> {
    try {
      await this.addJob(notification.id);
      this.logger.log(
        `Enqueued missing email job for notification ${notification.id} (${notification.type}) recipient ${notification.recipientId}`,
      );
      return;
    } catch (error: unknown) {
      this.logger.warn(
        `Initial enqueue failed for notification ${notification.id}; checking for a blocking retained job: ${this.errorMessage(error)}`,
      );
    }

    try {
      const blockingJob = await this.emailQueue.getJob(notification.id);
      if (!blockingJob) {
        this.logger.error(
          `Failed to enqueue missing email job ${notification.id}; no blocking job found, deferring to next sweep`,
        );
        return;
      }

      const blockingState = await blockingJob.getState();
      if (blockingState !== 'failed') {
        this.logger.warn(
          `Blocking job ${notification.id} is ${blockingState}; leaving it untouched and deferring to next sweep`,
        );
        return;
      }

      try {
        await blockingJob.remove();
      } catch (removeError: unknown) {
        this.logger.error(
          `Failed to remove blocking ${blockingState} job ${notification.id}; deferring to next sweep: ${this.errorMessage(removeError)}`,
        );
        return;
      }

      const stillPresent = await this.emailQueue.getJob(notification.id);
      if (stillPresent) {
        this.logger.warn(
          `Blocking job ${notification.id} still present after removal; deferring to next sweep`,
        );
        return;
      }

      await this.addJob(notification.id);
      this.logger.log(
        `Enqueued missing email job for notification ${notification.id} after removing a retained ${blockingState} job`,
      );
    } catch (error: unknown) {
      this.logger.error(
        `Failed to repair missing email job ${notification.id}; deferring to next sweep: ${this.errorMessage(error)}`,
      );
    }
  }

  private async addJob(notificationId: string): Promise<void> {
    await this.emailQueue.add(
      NOTIFICATION_EMAIL_JOB,
      { notificationId },
      { jobId: notificationId },
    );
  }

  private async markSent(notificationId: string): Promise<void> {
    const updated = await this.transitionFromPending(notificationId, {
      emailStatus: 'SENT',
      emailSentAt: new Date(),
    });
    if (!updated) {
      this.logger.log(
        `Notification ${notificationId} was already resolved; completed delivery evidence did not overwrite the terminal state`,
      );
    } else {
      this.logger.log(`Notification ${notificationId} reconciled as SENT from completed job`);
    }
  }

  private async markSkipped(notificationId: string, reason: string): Promise<void> {
    const updated = await this.transitionFromPending(notificationId, {
      emailStatus: 'SKIPPED',
    });
    if (updated) {
      this.logger.log(`Notification ${notificationId} reconciled as SKIPPED (${reason})`);
    } else {
      this.logger.log(
        `Notification ${notificationId} was already resolved; SKIPPED (${reason}) not applied`,
      );
    }
  }

  private async transitionFromPending(
    notificationId: string,
    data: {
      emailStatus: 'SENT' | 'SKIPPED' | 'FAILED';
      emailSentAt?: Date;
      emailLastError?: string;
    },
  ): Promise<boolean> {
    const result = await prisma.notification.updateMany({
      where: { id: notificationId, emailStatus: 'PENDING' },
      data,
    });
    return result.count > 0;
  }

  private logCompletion(
    notification: ReconcilableNotification,
    outcome: 'FAILED',
    updated: boolean,
  ): void {
    if (updated) {
      this.logger.warn(
        `Notification ${notification.id} (${notification.type}) reconciled as ${outcome} for recipient ${notification.recipientId}`,
      );
    } else {
      this.logger.log(
        `Notification ${notification.id} was already resolved; ${outcome} not applied`,
      );
    }
  }

  private isRecipientEligible(
    recipient: { email: string; isActive: boolean } | null | undefined,
  ): boolean {
    return Boolean(recipient?.isActive && recipient.email);
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private get enabled(): boolean {
    return this.configService.get<boolean>('notifications.email.reconcileEnabled', true);
  }

  private get batchSize(): number {
    return this.configService.get<number>(
      'notifications.email.reconcileBatchSize',
      DEFAULT_BATCH_SIZE,
    );
  }

  private get staleMinutes(): number {
    return this.configService.get<number>(
      'notifications.email.reconcileStaleMinutes',
      DEFAULT_STALE_MINUTES,
    );
  }

  private get maxAttempts(): number {
    return this.configService.get<number>('notifications.email.maxAttempts', DEFAULT_MAX_ATTEMPTS);
  }
}
