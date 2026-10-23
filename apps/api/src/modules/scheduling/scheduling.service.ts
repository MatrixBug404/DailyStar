import { Injectable, Logger, forwardRef, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Cron, CronExpression } from '@nestjs/schedule';
import { prisma } from '../../database/client';
import { WorkflowService } from '../workflow/workflow.service';

const ARTICLE_SWEEP_SELECT = {
  id: true,
  status: true,
  version: true,
  approvedRevisionId: true,
  currentPublishedRevisionId: true,
  deletedAt: true,
} as const;

/**
 * Maximum number of PENDING schedules inspected per database read during a
 * safety sweep. Kept small so the sweep never holds one long query, while the
 * keyset loop below guarantees every pending schedule is eventually visited.
 */
const SAFETY_SWEEP_BATCH_SIZE = 500;

interface PendingScheduleCursor {
  scheduledFor: Date;
  id: string;
}

@Injectable()
export class SchedulingService {
  private readonly logger = new Logger(SchedulingService.name);

  constructor(
    @InjectQueue('article-publishing') private publishingQueue: Queue,
    @Inject(forwardRef(() => WorkflowService))
    private readonly workflowService: WorkflowService,
    private readonly configService: ConfigService,
  ) {}

  private get maxRecoveryAttempts(): number {
    return this.configService.get<number>('scheduling.recoveryMaxAttempts', 3);
  }

  async enqueuePublishJob(
    scheduleId: string,
    articleId: string,
    expectedVersion: number,
    scheduledFor: Date,
  ) {
    const delay = Math.max(0, scheduledFor.getTime() - Date.now());
    await this.publishingQueue.add(
      'publish-article',
      { scheduleId, articleId, expectedVersion },
      { delay, jobId: scheduleId }, // deterministic jobId for deduplication
    );
    this.logger.log(`Enqueued publish job for schedule ${scheduleId} with delay ${delay}ms`);
  }

  async removePublishJob(scheduleId: string) {
    try {
      const job = await this.publishingQueue.getJob(scheduleId);
      if (job) {
        await job.remove();
        this.logger.log(`Removed publish job for schedule ${scheduleId}`);
      }
    } catch (error: any) {
      this.logger.warn(`Failed to remove publish job for schedule ${scheduleId}: ${error.message}`);
      // Best-effort removal; database state remains authoritative
    }
  }

  private async cancelPendingSchedule(scheduleId: string, reason: string) {
    const result = await prisma.publicationSchedule.updateMany({
      where: { id: scheduleId, status: 'PENDING' },
      data: { status: 'CANCELLED', lastError: reason },
    });
    if (result.count > 0) {
      this.logger.log(`Cancelled stale schedule ${scheduleId}: ${reason}`);
    }
    return result.count > 0;
  }

  private async markPendingScheduleExecuted(scheduleId: string) {
    const result = await prisma.publicationSchedule.updateMany({
      where: { id: scheduleId, status: 'PENDING' },
      data: { status: 'EXECUTED' },
    });
    if (result.count > 0) {
      this.logger.log(
        `Reconciled schedule ${scheduleId} as EXECUTED (intended revision already published)`,
      );
    }
    return result.count > 0;
  }

  private async removeJobBestEffort(scheduleId: string) {
    try {
      const job = await this.publishingQueue.getJob(scheduleId);
      if (job) await job.remove();
    } catch (redisErr: any) {
      this.logger.warn(`Redis unavailable while removing job ${scheduleId}: ${redisErr.message}`);
    }
  }

  /**
   * Atomically increments the scheduler-recovery counter.
   *
   * `PublicationSchedule.attempts` counts overdue missing/completed-job repairs
   * performed by the sweep. It is unrelated to BullMQ's execution attempts,
   * which remain in Redis (`job.attemptsMade`).
   *
   * Returns null when the schedule is no longer PENDING.
   */
  private async incrementRecoveryAttempt(scheduleId: string): Promise<number | null> {
    const updated = await prisma.publicationSchedule.updateMany({
      where: { id: scheduleId, status: 'PENDING' },
      data: { attempts: { increment: 1 } },
    });
    if (updated.count === 0) return null;

    const fresh = await prisma.publicationSchedule.findUnique({
      where: { id: scheduleId },
      select: { attempts: true, status: true },
    });
    if (!fresh || fresh.status !== 'PENDING') return null;
    return fresh.attempts;
  }

  /**
   * Reconciles schedules whose Article can no longer execute this intent.
   * Returns true when the schedule was handled and must not be enqueued.
   */
  private async reconcileStaleSchedule(schedule: any): Promise<boolean> {
    const article = schedule.article;

    if (!article) {
      await this.cancelPendingSchedule(schedule.id, 'Article not found');
      return true;
    }

    if (article.deletedAt) {
      await this.cancelPendingSchedule(schedule.id, 'Article deleted');
      return true;
    }

    if (article.status === 'PUBLISHED') {
      if (article.currentPublishedRevisionId === schedule.approvedRevisionId) {
        await this.markPendingScheduleExecuted(schedule.id);
      } else {
        await this.cancelPendingSchedule(
          schedule.id,
          'Article already published with a different revision',
        );
      }
      return true;
    }

    if (article.status !== 'SCHEDULED') {
      await this.cancelPendingSchedule(schedule.id, 'Article no longer SCHEDULED');
      return true;
    }

    return false;
  }

  private async sweepMissingJob(schedule: any) {
    const schedTime = new Date(schedule.scheduledFor);
    const isOverdue = schedTime.getTime() <= Date.now();

    if (isOverdue) {
      const attempts = await this.incrementRecoveryAttempt(schedule.id);
      if (attempts === null) return;
      if (attempts > this.maxRecoveryAttempts) {
        this.logger.warn(
          `Schedule ${schedule.id} exceeded recovery attempts (${attempts}/${this.maxRecoveryAttempts}). Invoking state-aware terminal handling.`,
        );
        await this.workflowService.recordTerminalFailure(
          schedule.id,
          'Scheduler recovery attempts exhausted',
        );
        return;
      }
    }

    const delay = Math.max(0, schedTime.getTime() - Date.now());
    this.logger.warn(
      `Missing BullMQ job for schedule ${schedule.id}. Enqueuing via sweep with remaining delay ${delay}ms.`,
    );
    try {
      await this.enqueuePublishJob(
        schedule.id,
        schedule.articleId,
        schedule.expectedArticleVersion,
        schedTime,
      );
    } catch (enqueueErr: any) {
      this.logger.error(`Failed to enqueue missing job ${schedule.id}: ${enqueueErr.message}`);
    }
  }

  private async sweepCompletedJob(schedule: any, job: any) {
    // Re-read after the Redis observation: the schedule/article may have changed
    // while this worker was completing without persisting its outcome.
    const fresh = await prisma.publicationSchedule.findUnique({
      where: { id: schedule.id },
      include: { article: { select: ARTICLE_SWEEP_SELECT } },
    });

    if (!fresh || fresh.status !== 'PENDING') {
      return;
    }

    const article = fresh.article;
    if (!article) {
      await this.cancelPendingSchedule(fresh.id, 'Article not found');
      return;
    }
    if (article.deletedAt) {
      await this.cancelPendingSchedule(fresh.id, 'Article deleted');
      return;
    }
    if (article.status === 'PUBLISHED') {
      if (article.currentPublishedRevisionId === fresh.approvedRevisionId) {
        await this.markPendingScheduleExecuted(fresh.id);
      } else {
        await this.cancelPendingSchedule(
          fresh.id,
          'Article already published with a different revision',
        );
      }
      return;
    }
    if (article.status !== 'SCHEDULED') {
      await this.cancelPendingSchedule(fresh.id, 'Article no longer SCHEDULED');
      return;
    }

    // A retained completed job with a still-valid PENDING schedule did not
    // persist its publication. Remove it before re-adding the deterministic ID.
    try {
      await job.remove();
    } catch (removeErr: any) {
      this.logger.error(
        `Failed to remove completed job ${fresh.id}; deferring re-enqueue to next sweep: ${removeErr.message}`,
      );
      return;
    }

    try {
      const stillPresent = await this.publishingQueue.getJob(fresh.id);
      if (stillPresent) {
        this.logger.warn(
          `Completed job ${fresh.id} still present after removal; deferring re-enqueue to next sweep.`,
        );
        return;
      }
    } catch (verifyErr: any) {
      this.logger.error(
        `Failed to verify removal of completed job ${fresh.id}; deferring re-enqueue: ${verifyErr.message}`,
      );
      return;
    }

    const isOverdue = new Date(fresh.scheduledFor).getTime() <= Date.now();
    if (isOverdue) {
      const attempts = await this.incrementRecoveryAttempt(fresh.id);
      if (attempts === null) return;
      if (attempts > this.maxRecoveryAttempts) {
        this.logger.warn(
          `Schedule ${fresh.id} exceeded recovery attempts (${attempts}/${this.maxRecoveryAttempts}). Invoking state-aware terminal handling.`,
        );
        await this.workflowService.recordTerminalFailure(
          fresh.id,
          'Scheduler recovery attempts exhausted',
        );
        return;
      }
    }

    try {
      await this.enqueuePublishJob(
        fresh.id,
        fresh.articleId,
        fresh.expectedArticleVersion,
        new Date(fresh.scheduledFor),
      );
    } catch (enqueueErr: any) {
      this.logger.error(`Failed to re-enqueue completed job ${fresh.id}: ${enqueueErr.message}`);
    }
  }

  /**
   * Reads one bounded page of PENDING schedules using keyset pagination.
   *
   * Ordering is deterministic on `(scheduledFor, id)` and the cursor is the
   * last row of the previous page, so concurrent inserts, cancellations, or
   * status changes cannot cause the sweep to revisit the same fixed window.
   * The query is a plain read and does not hold PostgreSQL locks across the
   * subsequent Redis calls.
   */
  private async findPendingSchedulesPage(cursor?: PendingScheduleCursor) {
    return prisma.publicationSchedule.findMany({
      where: {
        status: 'PENDING',
        ...(cursor
          ? {
              OR: [
                { scheduledFor: { gt: cursor.scheduledFor } },
                { scheduledFor: cursor.scheduledFor, id: { gt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ scheduledFor: 'asc' }, { id: 'asc' }],
      take: SAFETY_SWEEP_BATCH_SIZE,
      include: {
        article: {
          select: ARTICLE_SWEEP_SELECT,
        },
      },
    });
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async safetySweep() {
    this.logger.log('Running scheduling safety sweep...');
    try {
      // 1. Walk every PENDING schedule in bounded keyset pages. Multiple
      // application instances may run the same sweep concurrently; repairs
      // are guarded by conditional PENDING updates and the deterministic
      // BullMQ jobId, so duplicate observations are idempotent.
      // Read without holding open PostgreSQL row locks across Redis calls.
      let cursor: PendingScheduleCursor | undefined;

      while (true) {
        const pendingSchedules = await this.findPendingSchedulesPage(cursor);

        if (!pendingSchedules.length) {
          break;
        }

        for (const schedule of pendingSchedules) {
          // 2. Reconcile DB-only stale states before touching Redis. The sweep
          // never publishes directly.
          const reconciled = await this.reconcileStaleSchedule(schedule);
          if (reconciled) {
            await this.removeJobBestEffort(schedule.id);
            continue;
          }

          // 3. Inspect Redis / BullMQ with graceful fault tolerance.
          let job: any;
          try {
            job = await this.publishingQueue.getJob(schedule.id);
          } catch (redisErr: any) {
            this.logger.error(
              `Redis unavailable during safety sweep for schedule ${schedule.id}: ${redisErr.message}`,
            );
            // Do not mutate or corrupt DB state if Redis is unreachable.
            continue;
          }

          // 4. Repair missing jobs. Future schedules preserve their delay;
          // overdue repairs are bounded by the recovery counter.
          if (!job) {
            await this.sweepMissingJob(schedule);
            continue;
          }

          let jobState: string;
          try {
            jobState = await job.getState();
          } catch (redisErr: any) {
            this.logger.error(`Failed to get job state for ${schedule.id}: ${redisErr.message}`);
            continue;
          }

          // Active, delayed, or waiting jobs are actively queued or running.
          if (jobState === 'delayed' || jobState === 'waiting' || jobState === 'active') {
            continue;
          }

          // 5. Reconcile a retained completed job against persisted state.
          if (jobState === 'completed') {
            await this.sweepCompletedJob(schedule, job);
            continue;
          }

          // 6. Reconcile failed jobs with BullMQ's execution-retry policy.
          if (jobState === 'failed') {
            const maxAttempts = job.opts?.attempts || 3;
            if (job.attemptsMade < maxAttempts) {
              this.logger.log(
                `Job ${schedule.id} failed (${job.attemptsMade}/${maxAttempts}), retrying.`,
              );
              try {
                await job.retry();
              } catch (retryErr: any) {
                this.logger.error(`Failed to retry job ${schedule.id}: ${retryErr.message}`);
              }
            } else {
              this.logger.warn(
                `Job ${schedule.id} exhausted max retries (${job.attemptsMade}/${maxAttempts}). Persisting state-aware terminal outcome via WorkflowService.`,
              );
              await this.workflowService.recordTerminalFailure(
                schedule.id,
                job.failedReason || 'Max retries exhausted',
              );
            }
          }
        }

        if (pendingSchedules.length < SAFETY_SWEEP_BATCH_SIZE) {
          break;
        }

        // Advance the keyset cursor past the last row of this page. The next
        // page is strictly greater on (scheduledFor, id), so no schedule can
        // be skipped or starve behind a permanently re-read first page.
        const lastSchedule = pendingSchedules[pendingSchedules.length - 1];
        cursor = { scheduledFor: lastSchedule.scheduledFor, id: lastSchedule.id };
      }
    } catch (error: any) {
      this.logger.error(`Safety sweep failed: ${error.message}`, error.stack);
    }
  }
}
