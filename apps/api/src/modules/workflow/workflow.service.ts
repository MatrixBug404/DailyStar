import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { prisma } from '../../database/client';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class WorkflowService {
  constructor(private readonly auditService: AuditService) {}

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
    return prisma.$transaction(async (tx) => {
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

      return updated;
    });
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

  async requestChanges(id: string, user: any, expectedVersion?: number, comment?: string) {
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
          metadata: comment ? { reason: comment } : undefined,
          beforeState: { status: article.status },
          afterState: { status: updated.status },
        },
        tx,
      );

      return updated;
    });
  }

  async reject(id: string, user: any, expectedVersion?: number, comment?: string) {
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
          action: 'REJECT',
          actorId: user.sub,
          metadata: comment ? { reason: comment } : undefined,
          beforeState: { status: article.status },
          afterState: { status: updated.status },
        },
        tx,
      );

      return updated;
    });
  }

  async approve(id: string, user: any, expectedVersion?: number) {
    return prisma.$transaction(async (tx) => {
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

      return updated;
    });
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

  async schedule(id: string, user: any, expectedVersion?: number, scheduledFor?: string) {
    return prisma.$transaction(async (tx) => {
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

      const updated = await tx.article.update({
        where: { id },
        data: {
          status: 'SCHEDULED',
          scheduledFor: date,
          version: { increment: 1 },
          updatedBy: user.sub,
        },
      });

      await this.auditService.log(
        {
          entityType: 'Article',
          entityId: id,
          action: 'SCHEDULE',
          actorId: user.sub,
          beforeState: { status: article.status, scheduledFor: article.scheduledFor },
          afterState: { status: updated.status, scheduledFor: updated.scheduledFor },
        },
        tx,
      );

      return updated;
    });
  }

  async cancelSchedule(id: string, user: any, expectedVersion?: number) {
    return prisma.$transaction(async (tx) => {
      const article = await this.getArticle(id, user, expectedVersion, tx);
      if (article.status !== 'SCHEDULED')
        throw new BadRequestException('Article must be SCHEDULED');

      const updated = await tx.article.update({
        where: { id },
        data: {
          status: 'APPROVED',
          scheduledFor: null,
          version: { increment: 1 },
          updatedBy: user.sub,
        },
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

      return updated;
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

    const updated = await tx.article.update({
      where: { id },
      data: {
        status: 'DRAFT',
        approvedRevisionId: null,
        scheduledFor: null,
      },
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

  async getAuditLogs(id: string, user: any) {
    await this.getArticle(id, user, null); // checks visibility
    return prisma.auditLog.findMany({
      where: { entityType: 'Article', entityId: id },
      orderBy: { createdAt: 'desc' },
    });
  }
}
