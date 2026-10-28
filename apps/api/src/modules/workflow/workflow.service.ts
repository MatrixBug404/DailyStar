import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { NotificationType } from '@dailystar/types';
import { prisma } from '../../database/client';
import { AuditService } from '../audit/audit.service';
import {
  NotificationEventInput,
  NotificationsService,
} from '../notifications/notifications.service';
import { EmailDispatchService } from '../notifications/email/email-dispatch.service';

export class TerminalPublicationError extends Error {
  readonly isTerminal = true;
  constructor(message: string = 'Terminal publication failure') {
    super(message);
    this.name = 'TerminalPublicationError';
  }
}

interface NotificationEventDraft {
  type: NotificationType;
  articleId: string;
  primaryAuthorId: string | null;
  currentRevisionId: string | null;
  actorId: string | null;
  dedupeKey: string;
  title: string;
  body: (articleTitle: string, actorLabel: string) => string;
  data?: NotificationEventInput['data'];
}

@Injectable()
export class WorkflowService {
  private readonly logger = new Logger(WorkflowService.name);

  constructor(
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
    private readonly emailDispatchService: EmailDispatchService,
  ) {}

  /**
   * Adds the notification side effect to a lifecycle transition.
   *
   * All notification-only work is wrapped defensively: `createForEventSafely`
   * owns the savepoint for database errors, while this catch covers
   * implementation-level failures that occur before SQL. Neither can change
   * the already-applied transition.
   */
  private async createNotificationForEventSafely(
    tx: any,
    event: NotificationEventDraft,
  ): Promise<string[]> {
    try {
      const articleTitle = await this.resolveArticleTitle(tx, event.currentRevisionId);
      const actorLabel = await this.resolveActorLabel(tx, event.actorId);

      const created = await this.notificationsService.createForEventSafely(tx, {
        type: event.type,
        articleId: event.articleId,
        primaryAuthorId: event.primaryAuthorId,
        actorId: event.actorId,
        dedupeKey: event.dedupeKey,
        title: event.title,
        body: event.body(articleTitle, actorLabel),
        data: event.data,
      });

      return created.map((notification) => notification.id);
    } catch (error: unknown) {
      this.logger.warn(
        `Notification side effect failed for ${event.type} on article ${event.articleId}; ` +
          `workflow transition continues (${this.errorCode(error)})`,
      );
      return [];
    }
  }

  /**
   * Post-commit email enqueue. Never called inside `prisma.$transaction`.
   * Any failure is contained so it cannot alter the committed workflow outcome
   * or its response; the durable row remains for M3 reconciliation.
   */
  private async dispatchNotificationEmails(notificationIds: string[] | undefined): Promise<void> {
    if (!notificationIds || notificationIds.length === 0) {
      return;
    }

    try {
      await this.emailDispatchService.dispatchEmailsSafely(notificationIds);
    } catch (error: unknown) {
      this.logger.error(
        `Post-commit notification email dispatch failed; notifications remain durable ` +
          `(${this.errorCode(error)})`,
      );
    }
  }

  private async resolveArticleTitle(
    tx: any,
    currentRevisionId: string | null | undefined,
  ): Promise<string> {
    if (!currentRevisionId) {
      return 'Untitled article';
    }

    const revision = await tx.articleRevision.findUnique({
      where: { id: currentRevisionId },
      select: { title: true },
    });

    return revision?.title ?? 'Untitled article';
  }

  private async resolveActorLabel(tx: any, actorId: string | null): Promise<string> {
    if (!actorId) {
      return 'the scheduler';
    }

    const actor = await tx.user.findUnique({
      where: { id: actorId },
      select: { displayName: true },
    });

    return actor?.displayName ?? 'an editor';
  }

  /** Safe diagnostic only: error class/code, never message contents or PII. */
  private errorCode(error: unknown): string {
    if (error && typeof error === 'object' && 'code' in error) {
      return String((error as { code?: unknown }).code);
    }
    return error instanceof Error ? error.name : 'UnknownError';
  }

  private async getArticle(
    id: string,
    user: { sub: string; permissions: string[] },
    expectedVersion?: number | null,
    tx: any = prisma,
  ) {
    const article = await tx.article.findUnique({ where: { id } });
    if (!article || article.deletedAt) throw new NotFoundException('Article not found');

    // Visibility check
    if (article.primaryAuthorId !== user.sub && !user.permissions.includes('article.read.any')) {
      throw new NotFoundException('Article not found'); // Hide existence
    }

    if (expectedVersion !== null) {
      if (expectedVersion === undefined) {
        throw new BadRequestException('VERSION_REQUIRED');
      }
      if (expectedVersion !== article.version) {
        throw new ConflictException('VERSION_MISMATCH');
      }
    }

    return article;
  }

  async submitReview(id: string, user: any, expectedVersion?: number) {
    const result = await prisma.$transaction(async (tx) => {
      const article = await this.getArticle(id, user, expectedVersion, tx);
      if (article.status !== 'DRAFT')
        throw new BadRequestException('Article must be in DRAFT status to submit');

      const updated = await tx.article.update({
        where: { id },
        data: {
          status: 'SUBMITTED_FOR_REVIEW',
          version: { increment: 1 },
          updatedBy: user.sub,
        },
      });

      await this.auditService.log(
        {
          entityType: 'Article',
          entityId: id,
          action: 'SUBMIT_FOR_REVIEW',
          actorId: user.sub,
          beforeState: { status: article.status },
          afterState: { status: updated.status },
        },
        tx,
      );

      const notificationIds = await this.createNotificationForEventSafely(tx, {
        type: NotificationType.ARTICLE_SUBMITTED_FOR_REVIEW,
        articleId: id,
        primaryAuthorId: article.primaryAuthorId,
        currentRevisionId: article.currentRevisionId,
        actorId: user.sub,
        dedupeKey: `article-submitted:${id}:${updated.version}`,
        title: 'Article submitted for review',
        body: (articleTitle, actorLabel) =>
          `“${articleTitle}” was submitted for review by ${actorLabel}.`,
        data: { articleVersion: updated.version },
      });

      return { article: updated, notificationIds };
    });

    await this.dispatchNotificationEmails(result.notificationIds);
    return result.article;
  }

  async startReview(id: string, user: any, expectedVersion?: number) {
    return prisma.$transaction(async (tx) => {
      const article = await this.getArticle(id, user, expectedVersion, tx);
      if (article.status !== 'SUBMITTED_FOR_REVIEW')
        throw new BadRequestException('Article must be SUBMITTED_FOR_REVIEW');

      const updated = await tx.article.update({
        where: { id },
        data: {
          status: 'UNDER_REVIEW',
          reviewerId: user.sub,
          version: { increment: 1 },
          updatedBy: user.sub,
        },
      });

      await this.auditService.log(
        {
          entityType: 'Article',
          entityId: id,
          action: 'START_REVIEW',
          actorId: user.sub,
          beforeState: { status: article.status },
          afterState: { status: updated.status, reviewerId: user.sub },
        },
        tx,
      );

      return updated;
    });
  }

  async requestChanges(id: string, user: any, expectedVersion: number | undefined, comment: string) {
    return prisma.$transaction(async (tx) => {
      const article = await this.getArticle(id, user, expectedVersion, tx);
      if (article.status !== 'UNDER_REVIEW')
        throw new BadRequestException('Article must be UNDER_REVIEW');

      const updated = await tx.article.update({
        where: { id },
        data: {
          status: 'DRAFT',
          version: { increment: 1 },
          updatedBy: user.sub,
        },
      });

      await this.auditService.log(
        {
          entityType: 'Article',
          entityId: id,
          action: 'REQUEST_CHANGES',
          actorId: user.sub,
          metadata: { reason: comment },
          beforeState: { status: article.status },
          afterState: { status: updated.status },
        },
        tx,
      );

      return updated;
    });
  }

  async reject(id: string, user: any, expectedVersion: number | undefined, comment: string) {
    const result = await prisma.$transaction(async (tx) => {
      const article = await this.getArticle(id, user, expectedVersion, tx);
      if (article.status !== 'UNDER_REVIEW')
        throw new BadRequestException('Article must be UNDER_REVIEW');

      const updated = await tx.article.update({
        where: { id },
        data: {
          status: 'DRAFT',
          version: { increment: 1 },
          updatedBy: user.sub,
        },
      });

      await this.auditService.log(
        {
          entityType: 'Article',
          entityId: id,
          action: 'REJECT',
          actorId: user.sub,
          metadata: { reason: comment },
          beforeState: { status: article.status },
          afterState: { status: updated.status },
        },
        tx,
      );

      const notificationIds = await this.createNotificationForEventSafely(tx, {
        type: NotificationType.ARTICLE_REJECTED,
        articleId: id,
        primaryAuthorId: article.primaryAuthorId,
        currentRevisionId: article.currentRevisionId,
        actorId: user.sub,
        dedupeKey: `article-rejected:${id}:${updated.version}`,
        title: 'Article rejected',
        body: (articleTitle, actorLabel) => `“${articleTitle}” was rejected by ${actorLabel}.`,
        data: { articleVersion: updated.version },
      });

      return { article: updated, notificationIds };
    });

    await this.dispatchNotificationEmails(result.notificationIds);
    return result.article;
  }

  async approve(id: string, user: any, expectedVersion?: number) {
    const result = await prisma.$transaction(async (tx) => {
      const article = await this.getArticle(id, user, expectedVersion, tx);
      if (article.status !== 'UNDER_REVIEW')
        throw new BadRequestException('Article must be UNDER_REVIEW');

      const approvedRevisionId = article.currentRevisionId;
      if (!approvedRevisionId) throw new BadRequestException('No revision to approve');

      // Verify revision ownership (Amendment #2)
      const revision = await tx.articleRevision.findUnique({ where: { id: approvedRevisionId } });
      if (!revision || revision.articleId !== article.id) {
        throw new BadRequestException('Invalid revision ID');
      }

      // Check four-eyes principle (author cannot approve their own article)
      // unless bypassed (not in Phase 3 specs, so strictly enforced if they are primary author)
      if (article.primaryAuthorId === user.sub) {
        throw new ForbiddenException('Cannot approve own article (four-eyes principle)');
      }

      const updated = await tx.article.update({
        where: { id },
        data: {
          status: 'APPROVED',
          approvedRevisionId,
          version: { increment: 1 },
          updatedBy: user.sub,
        },
      });

      await this.auditService.log(
        {
          entityType: 'Article',
          entityId: id,
          action: 'APPROVE',
          actorId: user.sub,
          beforeState: { status: article.status, approvedRevisionId: article.approvedRevisionId },
          afterState: { status: updated.status, approvedRevisionId },
        },
        tx,
      );

      const notificationIds = await this.createNotificationForEventSafely(tx, {
        type: NotificationType.ARTICLE_APPROVED,
        articleId: id,
        primaryAuthorId: article.primaryAuthorId,
        currentRevisionId: article.currentRevisionId,
        actorId: user.sub,
        dedupeKey: `article-approved:${id}:${updated.version}`,
        title: 'Article approved',
        body: (articleTitle, actorLabel) => `“${articleTitle}” was approved by ${actorLabel}.`,
        data: { articleVersion: updated.version },
      });

      return { article: updated, notificationIds };
    });

    await this.dispatchNotificationEmails(result.notificationIds);
    return result.article;
  }

  async publish(id: string, user: any, expectedVersion?: number) {
    return prisma.$transaction(async (tx) => {
      const article = await this.getArticle(id, user, expectedVersion, tx);
      if (article.status !== 'APPROVED')
        throw new BadRequestException('Article must be APPROVED to publish');

      if (!article.approvedRevisionId) throw new BadRequestException('No approved revision found');

      const updated = await tx.article.update({
        where: { id },
        data: {
          status: 'PUBLISHED',
          currentPublishedRevisionId: article.approvedRevisionId,
          publishedAt: new Date(),
          version: { increment: 1 },
          updatedBy: user.sub,
        },
      });

      await this.auditService.log(
        {
          entityType: 'Article',
          entityId: id,
          action: 'PUBLISH',
          actorId: user.sub,
          beforeState: {
            status: article.status,
            currentPublishedRevisionId: article.currentPublishedRevisionId,
          },
          afterState: {
            status: updated.status,
            currentPublishedRevisionId: updated.currentPublishedRevisionId,
          },
        },
        tx,
      );

      return updated;
    });
  }

  private async lockPendingSchedules(tx: any, articleId: string) {
    // Keep a single lock order across all transactions that touch both tables:
    // PublicationSchedule rows first, then the Article row. The worker and
    // recordTerminalFailure use the same order, preventing deadlocks between
    // cancellation, publication, and terminal-failure recording.
    await tx.$queryRaw`
      SELECT "id" FROM "publication_schedules"
      WHERE "articleId" = ${articleId} AND "status" = 'PENDING'
      FOR UPDATE;
    `;
  }

  async schedule(id: string, user: any, expectedVersion?: number, scheduledFor?: string) {
    return prisma.$transaction(async (tx) => {
      // Serialize with soft deletion and use the shared schedule -> Article
      // lock order.
      await this.lockPendingSchedules(tx, id);
      await tx.$queryRaw`
        SELECT "id" FROM "articles" WHERE "id" = ${id} FOR UPDATE;
      `;

      const article = await this.getArticle(id, user, expectedVersion, tx);
      if (article.status !== 'APPROVED')
        throw new BadRequestException('Article must be APPROVED to schedule');
      if (!scheduledFor) throw new BadRequestException('scheduledFor is required');

      const date = new Date(scheduledFor);
      if (isNaN(date.getTime()))
        throw new BadRequestException('Invalid or past date for scheduling');

      const minimumScheduleTime = new Date(Date.now() + 5 * 60000);
      if (date <= minimumScheduleTime)
        throw new BadRequestException('scheduledFor must be at least 5 minutes in the future');

      const updatedArticle = await tx.article.update({
        where: { id },
        data: {
          status: 'SCHEDULED',
          scheduledFor: date,
          version: { increment: 1 },
          updatedBy: user.sub,
        },
      });

      const schedule = await tx.publicationSchedule.create({
        data: {
          articleId: id,
          scheduledFor: date,
          status: 'PENDING',
          scheduledById: user.sub,
          expectedArticleVersion: updatedArticle.version,
          approvedRevisionId: article.approvedRevisionId,
        }
      });

      await this.auditService.log(
        {
          entityType: 'Article',
          entityId: id,
          action: 'SCHEDULE',
          actorId: user.sub,
          beforeState: { status: article.status, scheduledFor: article.scheduledFor },
          afterState: { status: updatedArticle.status, scheduledFor: updatedArticle.scheduledFor },
        },
        tx,
      );

      return { article: updatedArticle, schedule };
    });
  }

  async cancelSchedule(id: string, user: any, expectedVersion?: number) {
    return prisma.$transaction(async (tx) => {
      const article = await this.getArticle(id, user, expectedVersion, tx);
      if (article.status !== 'SCHEDULED')
        throw new BadRequestException('Article must be SCHEDULED');

      await this.lockPendingSchedules(tx, id);

      // Re-read under lock: a concurrent worker may have published between the
      // initial read and acquiring the schedule locks. Cancellation must never
      // overwrite PUBLISHED/ARCHIVED state.
      const lockedArticles = await tx.$queryRaw<any[]>`
        SELECT "id", "status", "deletedAt"
        FROM "articles"
        WHERE "id" = ${id}
        FOR UPDATE;
      `;
      const current = lockedArticles?.[0];
      if (!current || current.deletedAt || current.status !== 'SCHEDULED') {
        throw new BadRequestException('Article must be SCHEDULED');
      }

      // Find all pending schedules for this article
      const pendingSchedules = await tx.publicationSchedule.findMany({
        where: { articleId: id, status: 'PENDING' },
        select: { id: true }
      });

      const updated = await tx.article.update({
        where: { id },
        data: {
          status: 'APPROVED',
          scheduledFor: null,
          version: { increment: 1 },
          updatedBy: user.sub,
        },
      });

      await tx.publicationSchedule.updateMany({
        where: { articleId: id, status: 'PENDING' },
        data: { status: 'CANCELLED' }
      });

      await this.auditService.log(
        {
          entityType: 'Article',
          entityId: id,
          action: 'CANCEL_SCHEDULE',
          actorId: user.sub,
          beforeState: { status: article.status, scheduledFor: article.scheduledFor },
          afterState: { status: updated.status, scheduledFor: null },
        },
        tx,
      );

      return { article: updated, cancelledScheduleIds: pendingSchedules.map((s: any) => s.id) };
    });
  }

  async archive(id: string, user: any, expectedVersion?: number) {
    return prisma.$transaction(async (tx) => {
      const article = await this.getArticle(id, user, expectedVersion, tx);
      if (article.status !== 'PUBLISHED')
        throw new BadRequestException('Article must be PUBLISHED');

      const updated = await tx.article.update({
        where: { id },
        data: {
          status: 'ARCHIVED',
          version: { increment: 1 },
          updatedBy: user.sub,
        },
      });

      await this.auditService.log(
        {
          entityType: 'Article',
          entityId: id,
          action: 'ARCHIVE',
          actorId: user.sub,
          beforeState: { status: article.status },
          afterState: { status: updated.status },
        },
        tx,
      );

      return updated;
    });
  }

  // --- Used by ArticlesService for Auto-Revert (Pattern A) ---
  async revertToDraft(id: string, user: { sub: string; permissions: string[] }, tx: any) {
    // This is called inside an existing transaction in ArticlesService
    const article = await this.getArticle(id, user, null, tx);

    await this.lockPendingSchedules(tx, id);

    // Re-read under lock so an edit cannot overwrite a concurrent publication.
    const lockedArticles = await tx.$queryRaw<any[]>`
      SELECT "id", "status", "deletedAt"
      FROM "articles"
      WHERE "id" = ${id}
      FOR UPDATE;
    `;
    const current = lockedArticles?.[0];
    if (
      !current ||
      current.deletedAt ||
      !['APPROVED', 'SCHEDULED', 'FAILED_TO_PUBLISH'].includes(current.status)
    ) {
      throw new ConflictException('Article state changed while reverting to DRAFT');
    }

    const updated = await tx.article.update({
      where: { id },
      data: {
        status: 'DRAFT',
        approvedRevisionId: null,
        scheduledFor: null,
      },
    });

    await tx.publicationSchedule.updateMany({
      where: { articleId: id, status: 'PENDING' },
      data: { status: 'CANCELLED', lastError: 'Auto-reverted due to edits' },
    });

    await this.auditService.log(
      {
        entityType: 'Article',
        entityId: id,
        action: 'ARTICLE_RESET_TO_DRAFT',
        actorId: user.sub,
        metadata: { reason: 'Auto-reverted due to edits' },
        beforeState: {
          status: article.status,
          approvedRevisionId: article.approvedRevisionId,
          scheduledFor: article.scheduledFor,
        },
        afterState: {
          status: updated.status,
          approvedRevisionId: null,
          scheduledFor: null,
        },
      },
      tx,
    );

    return updated;
  }

  // --- Reopen FAILED_TO_PUBLISH (or APPROVED/SCHEDULED) back to DRAFT ---
  async reopenDraft(id: string, user: any, expectedVersion?: number) {
    return prisma.$transaction(async (tx) => {
      const article = await this.getArticle(id, user, expectedVersion, tx);
      if (
        article.status !== 'FAILED_TO_PUBLISH' &&
        article.status !== 'APPROVED' &&
        article.status !== 'SCHEDULED'
      ) {
        throw new BadRequestException(
          'Article must be in FAILED_TO_PUBLISH, APPROVED, or SCHEDULED status to reopen to DRAFT',
        );
      }

      await this.lockPendingSchedules(tx, id);

      // Re-read under lock so reopening cannot overwrite a concurrent publication.
      const lockedArticles = await tx.$queryRaw<any[]>`
        SELECT "id", "status", "deletedAt"
        FROM "articles"
        WHERE "id" = ${id}
        FOR UPDATE;
      `;
      const current = lockedArticles?.[0];
      if (
        !current ||
        current.deletedAt ||
        !['FAILED_TO_PUBLISH', 'APPROVED', 'SCHEDULED'].includes(current.status)
      ) {
        throw new ConflictException('Article state changed while reopening to DRAFT');
      }

      const updated = await tx.article.update({
        where: { id },
        data: {
          status: 'DRAFT',
          approvedRevisionId: null,
          scheduledFor: null,
          version: { increment: 1 },
          updatedBy: user.sub,
        },
      });

      await tx.publicationSchedule.updateMany({
        where: { articleId: id, status: 'PENDING' },
        data: { status: 'CANCELLED', lastError: 'Reopened to DRAFT' },
      });

      await this.auditService.log(
        {
          entityType: 'Article',
          entityId: id,
          action: 'ARTICLE_RESET_TO_DRAFT',
          actorId: user.sub,
          metadata: { reason: 'Reopened to DRAFT' },
          beforeState: {
            status: article.status,
            approvedRevisionId: article.approvedRevisionId,
            scheduledFor: article.scheduledFor,
          },
          afterState: {
            status: updated.status,
            approvedRevisionId: null,
            scheduledFor: null,
          },
        },
        tx,
      );

      return updated;
    });
  }

  // --- Record terminal failure initiated by scheduler / sweep ---
  async recordTerminalFailure(scheduleId: string, reason: string) {
    const result = await prisma.$transaction(async (tx) => {
      // Lock the schedule first so cancellation, publication, and terminal-failure
      // recording cannot overwrite one another.
      const schedules = await tx.$queryRaw<any[]>`
        SELECT "id", "articleId", "status", "approvedRevisionId"
        FROM "publication_schedules"
        WHERE "id" = ${scheduleId}
        FOR UPDATE;
      `;
      const schedule = schedules?.[0];

      // A non-PENDING schedule has already reached a terminal outcome. Never
      // overwrite CANCELLED, EXECUTED, or FAILED with a late failure report.
      if (!schedule || schedule.status !== 'PENDING') {
        return null;
      }

      const articles = await tx.$queryRaw<any[]>`
        SELECT "id", "status", "version", "primaryAuthorId", "currentRevisionId", "approvedRevisionId", "currentPublishedRevisionId", "deletedAt"
        FROM "articles"
        WHERE "id" = ${schedule.articleId}
        FOR UPDATE;
      `;
      const article = articles?.[0];

      if (!article) {
        await tx.publicationSchedule.updateMany({
          where: { id: scheduleId, status: 'PENDING' },
          data: { status: 'CANCELLED', lastError: 'Article not found' },
        });
        return null;
      }

      if (article.deletedAt) {
        await tx.publicationSchedule.updateMany({
          where: { id: scheduleId, status: 'PENDING' },
          data: { status: 'CANCELLED', lastError: 'Article deleted' },
        });
        return null;
      }

      if (article.status === 'PUBLISHED') {
        if (article.currentPublishedRevisionId === schedule.approvedRevisionId) {
          await tx.publicationSchedule.updateMany({
            where: { id: scheduleId, status: 'PENDING' },
            data: { status: 'EXECUTED' },
          });
        } else {
          await tx.publicationSchedule.updateMany({
            where: { id: scheduleId, status: 'PENDING' },
            data: {
              status: 'CANCELLED',
              lastError: 'Article already published with a different revision',
            },
          });
        }
        return null;
      }

      if (article.status !== 'SCHEDULED') {
        await tx.publicationSchedule.updateMany({
          where: { id: scheduleId, status: 'PENDING' },
          data: { status: 'CANCELLED', lastError: 'Article no longer SCHEDULED' },
        });
        return null;
      }

      // Only a still-SCHEDULED article with a still-PENDING schedule represents
      // a genuine terminal publishing failure.
      const failed = await tx.publicationSchedule.updateMany({
        where: { id: scheduleId, status: 'PENDING' },
        data: { status: 'FAILED', lastError: reason },
      });
      if (failed.count === 0) {
        return null;
      }

      const updatedArticle = await tx.article.update({
        where: { id: article.id },
        data: {
          status: 'FAILED_TO_PUBLISH',
          version: { increment: 1 },
        },
      });

      await this.auditService.log(
        {
          entityType: 'Article',
          entityId: article.id,
          action: 'PUBLISH_FAILED',
          actorId: undefined,
          metadata: { system: 'scheduler', scheduleId, reason },
          beforeState: { status: article.status, version: article.version },
          afterState: { status: updatedArticle.status, version: updatedArticle.version },
        },
        tx,
      );

      const notificationIds = await this.createNotificationForEventSafely(tx, {
        type: NotificationType.ARTICLE_FAILED_TO_PUBLISH,
        articleId: article.id,
        primaryAuthorId: article.primaryAuthorId,
        currentRevisionId: article.currentRevisionId,
        actorId: null,
        dedupeKey: `article-publish-failed:${scheduleId}`,
        title: 'Article failed to publish',
        body: (articleTitle) => `“${articleTitle}” failed to publish: ${reason}.`,
        data: { scheduleId, reason },
      });

      return { article: updatedArticle, notificationIds };
    });

    if (!result) {
      return null;
    }

    await this.dispatchNotificationEmails(result.notificationIds);
    return result.article;
  }

  async executeScheduledPublish(scheduleId: string) {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Load PublicationSchedule with FOR UPDATE to serialize concurrent workers
      const schedules = await tx.$queryRaw<any[]>`
        SELECT "id", "articleId", "scheduledFor", "status", "expectedArticleVersion", "approvedRevisionId"
        FROM "publication_schedules"
        WHERE "id" = ${scheduleId}
        FOR UPDATE;
      `;
      const schedule = schedules?.[0];

      if (!schedule) {
        return { success: false, terminal: true, error: `Schedule ${scheduleId} not found` };
      }

      if (schedule.status === 'EXECUTED') {
        // Idempotent duplicate worker execution: already successfully executed
        const article = await tx.article.findUnique({ where: { id: schedule.articleId } });
        return { success: true, alreadyExecuted: true, article };
      }

      if (schedule.status !== 'PENDING') {
        return {
          success: false,
          terminal: true,
          error: `Schedule ${scheduleId} is no longer PENDING (status: ${schedule.status})`,
        };
      }

      // 2. Load Article with FOR UPDATE
      const articles = await tx.$queryRaw<any[]>`
        SELECT "id", "status", "version", "primaryAuthorId", "currentRevisionId", "approvedRevisionId", "currentPublishedRevisionId", "deletedAt"
        FROM "articles"
        WHERE "id" = ${schedule.articleId}
        FOR UPDATE;
      `;
      const article = articles?.[0];

      if (!article) {
        // Orphaned schedule: reconcile without mutating any Article row.
        await tx.publicationSchedule.updateMany({
          where: { id: scheduleId, status: 'PENDING' },
          data: { status: 'CANCELLED', lastError: 'Article not found' },
        });
        return { success: false, terminal: true, error: 'Article not found' };
      }

      // A soft-deleted article is a stale intent, never a publishing failure.
      if (article.deletedAt) {
        await tx.publicationSchedule.updateMany({
          where: { id: scheduleId, status: 'PENDING' },
          data: { status: 'CANCELLED', lastError: 'Article deleted' },
        });
        return { success: false, terminal: true, error: 'Article deleted' };
      }

      // Already-published reconciliation must use the intended revision, not
      // Article.status alone.
      if (article.status === 'PUBLISHED') {
        if (article.currentPublishedRevisionId === schedule.approvedRevisionId) {
          await tx.publicationSchedule.updateMany({
            where: { id: scheduleId, status: 'PENDING' },
            data: { status: 'EXECUTED' },
          });
          return { success: true, alreadyExecuted: true, article };
        }

        await tx.publicationSchedule.updateMany({
          where: { id: scheduleId, status: 'PENDING' },
          data: {
            status: 'CANCELLED',
            lastError: 'Article already published with a different revision',
          },
        });
        return {
          success: false,
          terminal: true,
          error: 'Article already published with a different revision',
        };
      }

      // Any other non-SCHEDULED state is a stale schedule, not a publishing failure.
      if (article.status !== 'SCHEDULED') {
        await tx.publicationSchedule.updateMany({
          where: { id: scheduleId, status: 'PENDING' },
          data: { status: 'CANCELLED', lastError: 'Article no longer SCHEDULED' },
        });
        return { success: false, terminal: true, error: 'Article no longer SCHEDULED' };
      }

      if (schedule.expectedArticleVersion !== article.version) {
        const reason = 'VERSION_MISMATCH';
        const failed = await tx.publicationSchedule.updateMany({
          where: { id: scheduleId, status: 'PENDING' },
          data: { status: 'FAILED', lastError: reason },
        });
        if (failed.count === 0) {
          return { success: false, terminal: true, error: 'Concurrent schedule state change' };
        }
        const updatedArticle = await tx.article.update({
          where: { id: article.id },
          data: { status: 'FAILED_TO_PUBLISH', version: { increment: 1 } },
        });
        await this.auditService.log(
          {
            entityType: 'Article',
            entityId: article.id,
            action: 'PUBLISH_FAILED',
            actorId: undefined,
            metadata: {
              system: 'scheduler',
              scheduleId,
              reason,
              expectedArticleVersion: schedule.expectedArticleVersion,
              actualArticleVersion: article.version,
            },
            beforeState: { status: article.status, version: article.version },
            afterState: { status: updatedArticle.status, version: updatedArticle.version },
          },
          tx,
        );

        const notificationIds = await this.createNotificationForEventSafely(tx, {
          type: NotificationType.ARTICLE_FAILED_TO_PUBLISH,
          articleId: article.id,
          primaryAuthorId: article.primaryAuthorId,
          currentRevisionId: article.currentRevisionId,
          actorId: null,
          dedupeKey: `article-publish-failed:${scheduleId}`,
          title: 'Article failed to publish',
          body: (articleTitle) => `“${articleTitle}” failed to publish: ${reason}.`,
          data: { scheduleId, reason },
        });

        return { success: false, terminal: true, error: reason, notificationIds };
      }

      if (
        !article.approvedRevisionId ||
        schedule.approvedRevisionId !== article.approvedRevisionId
      ) {
        const reason = 'REVISION_MISMATCH';
        const failed = await tx.publicationSchedule.updateMany({
          where: { id: scheduleId, status: 'PENDING' },
          data: { status: 'FAILED', lastError: reason },
        });
        if (failed.count === 0) {
          return { success: false, terminal: true, error: 'Concurrent schedule state change' };
        }
        const updatedArticle = await tx.article.update({
          where: { id: article.id },
          data: { status: 'FAILED_TO_PUBLISH', version: { increment: 1 } },
        });
        await this.auditService.log(
          {
            entityType: 'Article',
            entityId: article.id,
            action: 'PUBLISH_FAILED',
            actorId: undefined,
            metadata: {
              system: 'scheduler',
              scheduleId,
              reason,
              expectedRevisionId: schedule.approvedRevisionId,
              actualRevisionId: article.approvedRevisionId,
            },
            beforeState: { status: article.status, version: article.version },
            afterState: { status: updatedArticle.status, version: updatedArticle.version },
          },
          tx,
        );

        const notificationIds = await this.createNotificationForEventSafely(tx, {
          type: NotificationType.ARTICLE_FAILED_TO_PUBLISH,
          articleId: article.id,
          primaryAuthorId: article.primaryAuthorId,
          currentRevisionId: article.currentRevisionId,
          actorId: null,
          dedupeKey: `article-publish-failed:${scheduleId}`,
          title: 'Article failed to publish',
          body: (articleTitle) => `“${articleTitle}” failed to publish: ${reason}.`,
          data: { scheduleId, reason },
        });

        return { success: false, terminal: true, error: reason, notificationIds };
      }

      // Verify approved revision exists in database
      const revision = await tx.articleRevision.findUnique({
        where: { id: schedule.approvedRevisionId },
      });
      if (!revision || revision.articleId !== article.id) {
        const reason = 'APPROVED_REVISION_NOT_FOUND';
        const failed = await tx.publicationSchedule.updateMany({
          where: { id: scheduleId, status: 'PENDING' },
          data: { status: 'FAILED', lastError: reason },
        });
        if (failed.count === 0) {
          return { success: false, terminal: true, error: 'Concurrent schedule state change' };
        }
        const updatedArticle = await tx.article.update({
          where: { id: article.id },
          data: { status: 'FAILED_TO_PUBLISH', version: { increment: 1 } },
        });
        await this.auditService.log(
          {
            entityType: 'Article',
            entityId: article.id,
            action: 'PUBLISH_FAILED',
            actorId: undefined,
            metadata: { system: 'scheduler', scheduleId, reason },
            beforeState: { status: article.status, version: article.version },
            afterState: { status: updatedArticle.status, version: updatedArticle.version },
          },
          tx,
        );

        const notificationIds = await this.createNotificationForEventSafely(tx, {
          type: NotificationType.ARTICLE_FAILED_TO_PUBLISH,
          articleId: article.id,
          primaryAuthorId: article.primaryAuthorId,
          currentRevisionId: article.currentRevisionId,
          actorId: null,
          dedupeKey: `article-publish-failed:${scheduleId}`,
          title: 'Article failed to publish',
          body: (articleTitle) => `“${articleTitle}” failed to publish: ${reason}.`,
          data: { scheduleId, reason },
        });

        return { success: false, terminal: true, error: reason, notificationIds };
      }

      // Perform the transition to PUBLISHED
      const updatedArticle = await tx.article.update({
        where: { id: article.id },
        data: {
          status: 'PUBLISHED',
          currentPublishedRevisionId: schedule.approvedRevisionId,
          publishedAt: new Date(),
          version: { increment: 1 },
        },
      });

      const executed = await tx.publicationSchedule.updateMany({
        where: { id: scheduleId, status: 'PENDING' },
        data: { status: 'EXECUTED' },
      });
      if (executed.count === 0) {
        // The schedule changed under us. Roll back the publish transition and
        // let the next attempt reconcile; never report a false success.
        throw new Error('Schedule state changed during publication');
      }

      const now = new Date();
      const schedDate = new Date(schedule.scheduledFor);
      const isMissed = now.getTime() - schedDate.getTime() > 5 * 60 * 1000;

      if (isMissed) {
        await this.auditService.log(
          {
            entityType: 'Article',
            entityId: article.id,
            action: 'SCHEDULE_MISSED',
            actorId: undefined,
            metadata: {
              system: 'scheduler',
              delayMs: now.getTime() - schedDate.getTime(),
              scheduledFor: schedDate.toISOString(),
            },
          },
          tx,
        );
      }

      await this.auditService.log(
        {
          entityType: 'Article',
          entityId: article.id,
          action: 'PUBLISH',
          actorId: undefined,
          metadata: { system: 'scheduler', scheduleId },
          beforeState: {
            status: article.status,
            currentPublishedRevisionId: article.currentPublishedRevisionId,
          },
          afterState: {
            status: updatedArticle.status,
            currentPublishedRevisionId: updatedArticle.currentPublishedRevisionId,
          },
        },
        tx,
      );

      return { success: true, article: updatedArticle };
    });

    // Dispatch after commit, before throwing the terminal error so a scheduled
    // failure still enqueues its notification email exactly once.
    const notificationIds = 'notificationIds' in result ? result.notificationIds : undefined;
    await this.dispatchNotificationEmails(notificationIds);

    if (!result.success) {
      throw new TerminalPublicationError(result.error || 'Terminal publication failure');
    }

    return result.article;
  }

  async getAuditLogs(id: string, user: any) {
    await this.getArticle(id, user, null); // checks visibility
    return prisma.auditLog.findMany({
      where: { entityType: 'Article', entityId: id },
      orderBy: { createdAt: 'desc' },
    });
  }
}
