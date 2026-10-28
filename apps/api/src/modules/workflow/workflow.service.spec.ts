import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, ConflictException } from '@nestjs/common';
import { NotificationType } from '@dailystar/types';
import { WorkflowService, TerminalPublicationError } from './workflow.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailDispatchService } from '../notifications/email/email-dispatch.service';

const mockTx = {
  article: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  articleRevision: {
    findUnique: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
  publicationSchedule: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  $queryRaw: jest.fn(),
};

jest.mock('../../database/client', () => ({
  prisma: {
    article: {
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    publicationSchedule: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  },
}));

import { prisma } from '../../database/client';

describe('WorkflowService (Phase 7 Unit Tests)', () => {
  let service: WorkflowService;
  let auditService: AuditService;
  let notificationsService: {
    createForEventSafely: jest.Mock;
  };
  let emailDispatchService: {
    dispatchEmailsSafely: jest.Mock;
  };

  const mockUser = {
    sub: 'user-author-1',
    permissions: ['article.create', 'article.submit-review', 'article.update.own'],
  };

  const mockEditor = {
    sub: 'user-editor-1',
    permissions: ['article.approve', 'article.publish', 'article.schedule', 'article.cancel-schedule', 'article.read.any', 'article.update.any'],
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockTx.$queryRaw.mockReset();
    mockTx.article.findUnique.mockReset();
    mockTx.article.update.mockReset();
    mockTx.articleRevision.findUnique.mockReset();
    mockTx.user.findUnique.mockReset();
    mockTx.user.findUnique.mockResolvedValue({ displayName: 'Editor One' });
    mockTx.publicationSchedule.findMany.mockReset();
    mockTx.publicationSchedule.findUnique.mockReset();
    mockTx.publicationSchedule.updateMany.mockReset();
    mockTx.publicationSchedule.updateMany.mockResolvedValue({ count: 1 });

    notificationsService = {
      createForEventSafely: jest.fn().mockResolvedValue([{ id: 'notification-1' }]),
    };
    emailDispatchService = {
      dispatchEmailsSafely: jest.fn().mockResolvedValue(undefined),
    };

    (prisma.$transaction as jest.Mock).mockImplementation(async (callback) => {
      if (typeof callback === 'function') {
        return callback(mockTx);
      }
      return Promise.all(callback);
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowService,
        {
          provide: AuditService,
          useValue: {
            log: jest.fn().mockResolvedValue({ id: 'audit-1' }),
          },
        },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: EmailDispatchService, useValue: emailDispatchService },
      ],
    }).compile();

    service = module.get<WorkflowService>(WorkflowService);
    auditService = module.get<AuditService>(AuditService);
  });

  describe('Notification event integration (Phase 8 M4)', () => {
    const author = { sub: 'author-1', permissions: ['article.submit-review'] };
    const editor = {
      sub: 'editor-1',
      permissions: ['article.read.any', 'article.approve', 'article.reject'],
    };

    function draftArticle(overrides: Record<string, unknown> = {}) {
      return {
        id: 'article-1',
        status: 'DRAFT',
        primaryAuthorId: author.sub,
        currentRevisionId: 'rev-1',
        version: 1,
        deletedAt: null,
        ...overrides,
      };
    }

    beforeEach(() => {
      mockTx.articleRevision.findUnique.mockResolvedValue({
        id: 'rev-1',
        articleId: 'article-1',
        title: 'M4 Article',
      });
    });

    it('submitReview creates editor notifications with the versioned dedupe key after the audit write', async () => {
      mockTx.article.findUnique.mockResolvedValue(draftArticle());
      mockTx.article.update.mockResolvedValue(draftArticle({ status: 'SUBMITTED_FOR_REVIEW', version: 2 }));

      const result = await service.submitReview('article-1', author, 1);

      expect(result.status).toBe('SUBMITTED_FOR_REVIEW');
      expect(notificationsService.createForEventSafely).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({
          type: NotificationType.ARTICLE_SUBMITTED_FOR_REVIEW,
          articleId: 'article-1',
          primaryAuthorId: author.sub,
          actorId: author.sub,
          dedupeKey: 'article-submitted:article-1:2',
          title: 'Article submitted for review',
          body: '“M4 Article” was submitted for review by Editor One.',
          data: { articleVersion: 2 },
        }),
      );
      expect(emailDispatchService.dispatchEmailsSafely).toHaveBeenCalledWith(['notification-1']);

      const auditOrder = (auditService.log as jest.Mock).mock.invocationCallOrder[0];
      const notificationOrder = notificationsService.createForEventSafely.mock.invocationCallOrder[0];
      const dispatchOrder = emailDispatchService.dispatchEmailsSafely.mock.invocationCallOrder[0];
      expect(auditOrder).toBeLessThan(notificationOrder);
      expect(notificationOrder).toBeLessThan(dispatchOrder);
    });

    it('approve targets the author dedupe key and dispatches only after the transaction', async () => {
      mockTx.article.findUnique.mockResolvedValue(
        draftArticle({ status: 'UNDER_REVIEW', version: 2 }),
      );
      mockTx.article.update.mockResolvedValue(
        draftArticle({ status: 'APPROVED', version: 3, approvedRevisionId: 'rev-1' }),
      );

      const result = await service.approve('article-1', editor, 2);

      expect(result.status).toBe('APPROVED');
      expect(notificationsService.createForEventSafely).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({
          type: NotificationType.ARTICLE_APPROVED,
          dedupeKey: 'article-approved:article-1:3',
          body: '“M4 Article” was approved by Editor One.',
          data: { articleVersion: 3 },
        }),
      );
      const transactionOrder = (prisma.$transaction as jest.Mock).mock.invocationCallOrder[0];
      const dispatchOrder = emailDispatchService.dispatchEmailsSafely.mock.invocationCallOrder[0];
      expect(transactionOrder).toBeLessThan(dispatchOrder);
    });

    it('reject targets the author dedupe key', async () => {
      mockTx.article.findUnique.mockResolvedValue(
        draftArticle({ status: 'UNDER_REVIEW', version: 2 }),
      );
      mockTx.article.update.mockResolvedValue(draftArticle({ status: 'DRAFT', version: 3 }));

      const result = await service.reject('article-1', editor, 2, 'Needs work');

      expect(result.status).toBe('DRAFT');
      expect(notificationsService.createForEventSafely).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({
          type: NotificationType.ARTICLE_REJECTED,
          dedupeKey: 'article-rejected:article-1:3',
          body: '“M4 Article” was rejected by Editor One.',
        }),
      );
    });

    it('requestChanges has no notification side effect (OD-2 deferred)', async () => {
      mockTx.article.findUnique.mockResolvedValue(
        draftArticle({ status: 'UNDER_REVIEW', version: 2 }),
      );
      mockTx.article.update.mockResolvedValue(draftArticle({ status: 'DRAFT', version: 3 }));

      await service.requestChanges('article-1', editor, 2, 'Please revise');

      expect(notificationsService.createForEventSafely).not.toHaveBeenCalled();
      expect(emailDispatchService.dispatchEmailsSafely).not.toHaveBeenCalled();
    });

    it('notification implementation failure cannot prevent the transition response', async () => {
      mockTx.article.findUnique.mockResolvedValue(draftArticle());
      mockTx.article.update.mockResolvedValue(
        draftArticle({ status: 'SUBMITTED_FOR_REVIEW', version: 2 }),
      );
      notificationsService.createForEventSafely.mockRejectedValue(new Error('insert exploded'));

      const result = await service.submitReview('article-1', author, 1);

      expect(result.status).toBe('SUBMITTED_FOR_REVIEW');
      expect(mockTx.article.update).toHaveBeenCalled();
      expect(emailDispatchService.dispatchEmailsSafely).not.toHaveBeenCalled();
    });

    it('email dispatch failure cannot replace a successful transition outcome', async () => {
      mockTx.article.findUnique.mockResolvedValue(draftArticle());
      mockTx.article.update.mockResolvedValue(
        draftArticle({ status: 'SUBMITTED_FOR_REVIEW', version: 2 }),
      );
      emailDispatchService.dispatchEmailsSafely.mockRejectedValue(new Error('redis down'));

      await expect(service.submitReview('article-1', author, 1)).resolves.toMatchObject({
        status: 'SUBMITTED_FOR_REVIEW',
      });
    });
  });

  describe('Scheduling Lead-Time & Workflow States', () => {
    it('should reject scheduling if scheduledFor is missing', async () => {
      mockTx.article.findUnique.mockResolvedValue({
        id: 'art-1',
        status: 'APPROVED',
        primaryAuthorId: mockUser.sub,
        version: 1,
      });

      await expect(service.schedule('art-1', mockEditor, 1, undefined)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject scheduling if scheduledFor is less than 5 minutes in the future', async () => {
      mockTx.article.findUnique.mockResolvedValue({
        id: 'art-1',
        status: 'APPROVED',
        primaryAuthorId: mockUser.sub,
        version: 1,
      });

      const nearFuture = new Date(Date.now() + 3 * 60000).toISOString();
      await expect(service.schedule('art-1', mockEditor, 1, nearFuture)).rejects.toThrow(
        'scheduledFor must be at least 5 minutes in the future',
      );
    });

    it('should reject scheduling if article is in DRAFT status', async () => {
      mockTx.article.findUnique.mockResolvedValue({
        id: 'art-1',
        status: 'DRAFT',
        primaryAuthorId: mockUser.sub,
        version: 1,
      });

      const validFuture = new Date(Date.now() + 10 * 60000).toISOString();
      await expect(service.schedule('art-1', mockEditor, 1, validFuture)).rejects.toThrow(
        'Article must be APPROVED to schedule',
      );
    });

    it('should successfully schedule an APPROVED article and log SCHEDULE audit event', async () => {
      const scheduledDate = new Date(Date.now() + 10 * 60000);
      mockTx.article.findUnique.mockResolvedValue({
        id: 'art-1',
        status: 'APPROVED',
        primaryAuthorId: mockUser.sub,
        approvedRevisionId: 'rev-1',
        version: 2,
        scheduledFor: null,
      });

      mockTx.article.update.mockResolvedValue({
        id: 'art-1',
        status: 'SCHEDULED',
        scheduledFor: scheduledDate,
        version: 3,
      });

      mockTx.publicationSchedule.create.mockResolvedValue({
        id: 'sched-1',
        articleId: 'art-1',
        scheduledFor: scheduledDate,
        status: 'PENDING',
        expectedArticleVersion: 3,
        approvedRevisionId: 'rev-1',
      });

      const result = await service.schedule('art-1', mockEditor, 2, scheduledDate.toISOString());

      expect(result.article.status).toBe('SCHEDULED');
      expect(result.schedule.id).toBe('sched-1');
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'SCHEDULE',
          entityId: 'art-1',
          actorId: mockEditor.sub,
        }),
        mockTx,
      );
    });
  });

  describe('Schedule Cancellation', () => {
    it('should reject cancellation if article is not SCHEDULED', async () => {
      mockTx.article.findUnique.mockResolvedValue({
        id: 'art-1',
        status: 'APPROVED',
        primaryAuthorId: mockUser.sub,
        version: 1,
      });

      await expect(service.cancelSchedule('art-1', mockEditor, 1)).rejects.toThrow(
        'Article must be SCHEDULED',
      );
    });

    it('should successfully cancel schedule and revert article to APPROVED', async () => {
      mockTx.article.findUnique.mockResolvedValue({
        id: 'art-1',
        status: 'SCHEDULED',
        scheduledFor: new Date(),
        primaryAuthorId: mockUser.sub,
        version: 3,
      });
      mockTx.$queryRaw.mockResolvedValue([
        { id: 'art-1', status: 'SCHEDULED', deletedAt: null },
      ]);

      mockTx.article.update.mockResolvedValue({
        id: 'art-1',
        status: 'APPROVED',
        scheduledFor: null,
        version: 4,
      });

      mockTx.publicationSchedule.findMany.mockResolvedValue([{ id: 'sched-1' }]);

      const result = await service.cancelSchedule('art-1', mockEditor, 3);

      expect(result.article.status).toBe('APPROVED');
      expect(result.cancelledScheduleIds).toEqual(['sched-1']);
      expect(mockTx.publicationSchedule.updateMany).toHaveBeenCalledWith({
        where: { articleId: 'art-1', status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CANCEL_SCHEDULE',
          entityId: 'art-1',
        }),
        mockTx,
      );
    });

    it('should not overwrite an article that was published after the initial read', async () => {
      mockTx.article.findUnique.mockResolvedValue({
        id: 'art-1',
        status: 'SCHEDULED',
        scheduledFor: new Date(),
        primaryAuthorId: mockUser.sub,
        version: 3,
      });
      // The concurrent worker won and committed PUBLISHED before cancellation
      // acquired the Article row lock.
      mockTx.$queryRaw.mockResolvedValue([
        { id: 'art-1', status: 'PUBLISHED', deletedAt: null },
      ]);

      await expect(service.cancelSchedule('art-1', mockEditor, 3)).rejects.toThrow(
        'Article must be SCHEDULED',
      );

      expect(mockTx.article.update).not.toHaveBeenCalled();
      expect(mockTx.publicationSchedule.updateMany).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
    });
  });

  describe('executeScheduledPublish - Validations & Terminal Failures', () => {
    it('should handle duplicate worker execution idempotently (already EXECUTED)', async () => {
      mockTx.$queryRaw.mockResolvedValueOnce([
        {
          id: 'sched-1',
          articleId: 'art-1',
          status: 'EXECUTED',
          expectedArticleVersion: 3,
          approvedRevisionId: 'rev-1',
          scheduledFor: new Date(),
        },
      ]);
      mockTx.article.findUnique.mockResolvedValue({ id: 'art-1', status: 'PUBLISHED' });

      const result = await service.executeScheduledPublish('sched-1');
      expect(result).toBeDefined();
      expect(result?.status).toBe('PUBLISHED');
      // Must not re-publish or log duplicate publish
      expect(mockTx.article.update).not.toHaveBeenCalled();
    });

    it('should reject with TerminalPublicationError if schedule is no longer PENDING', async () => {
      mockTx.$queryRaw.mockResolvedValueOnce([
        {
          id: 'sched-1',
          articleId: 'art-1',
          status: 'CANCELLED',
        },
      ]);

      try {
        await service.executeScheduledPublish('sched-1');
        fail('Should have thrown TerminalPublicationError');
      } catch (err: any) {
        expect(err).toBeInstanceOf(TerminalPublicationError);
        expect(err.message).toContain('is no longer PENDING');
      }
    });

    it('should persist FAILED_TO_PUBLISH and PUBLISH_FAILED audit event on version mismatch', async () => {
      mockTx.$queryRaw
        .mockResolvedValueOnce([
          {
            id: 'sched-1',
            articleId: 'art-1',
            status: 'PENDING',
            expectedArticleVersion: 3,
            approvedRevisionId: 'rev-1',
            scheduledFor: new Date(),
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 'art-1',
            status: 'SCHEDULED',
            version: 4, // Version mismatch! (Expected 3, actual 4)
            approvedRevisionId: 'rev-1',
          },
        ]);

      mockTx.article.update.mockResolvedValue({
        id: 'art-1',
        status: 'FAILED_TO_PUBLISH',
        version: 5,
      });

      try {
        await service.executeScheduledPublish('sched-1');
        fail('Should have thrown TerminalPublicationError');
      } catch (err: any) {
        expect(err).toBeInstanceOf(TerminalPublicationError);
        expect(err.message).toBe('VERSION_MISMATCH');
      }

      // Assert persistence:
      expect(mockTx.article.update).toHaveBeenCalledWith({
        where: { id: 'art-1' },
        data: { status: 'FAILED_TO_PUBLISH', version: { increment: 1 } },
      });
      expect(mockTx.publicationSchedule.updateMany).toHaveBeenCalledWith({
        where: { id: 'sched-1', status: 'PENDING' },
        data: { status: 'FAILED', lastError: 'VERSION_MISMATCH' },
      });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'PUBLISH_FAILED',
          entityId: 'art-1',
          actorId: undefined, // null in DB
          metadata: expect.objectContaining({
            system: 'scheduler',
            reason: 'VERSION_MISMATCH',
            expectedArticleVersion: 3,
            actualArticleVersion: 4,
          }),
        }),
        mockTx,
      );
      expect(notificationsService.createForEventSafely).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({
          type: NotificationType.ARTICLE_FAILED_TO_PUBLISH,
          articleId: 'art-1',
          actorId: null,
          dedupeKey: 'article-publish-failed:sched-1',
          data: { scheduleId: 'sched-1', reason: 'VERSION_MISMATCH' },
        }),
      );
      expect(notificationsService.createForEventSafely).toHaveBeenCalledTimes(1);
      expect(emailDispatchService.dispatchEmailsSafely).toHaveBeenCalledWith(['notification-1']);
    });

    it('should persist FAILED_TO_PUBLISH and PUBLISH_FAILED audit event on approved revision mismatch', async () => {
      mockTx.$queryRaw
        .mockResolvedValueOnce([
          {
            id: 'sched-1',
            articleId: 'art-1',
            status: 'PENDING',
            expectedArticleVersion: 3,
            approvedRevisionId: 'rev-1',
            scheduledFor: new Date(),
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 'art-1',
            status: 'SCHEDULED',
            version: 3,
            approvedRevisionId: 'rev-different', // Revision mismatch!
          },
        ]);

      mockTx.article.update.mockResolvedValue({
        id: 'art-1',
        status: 'FAILED_TO_PUBLISH',
        version: 4,
      });

      await expect(service.executeScheduledPublish('sched-1')).rejects.toThrow('REVISION_MISMATCH');

      expect(mockTx.article.update).toHaveBeenCalledWith({
        where: { id: 'art-1' },
        data: { status: 'FAILED_TO_PUBLISH', version: { increment: 1 } },
      });
      expect(mockTx.publicationSchedule.updateMany).toHaveBeenCalledWith({
        where: { id: 'sched-1', status: 'PENDING' },
        data: { status: 'FAILED', lastError: 'REVISION_MISMATCH' },
      });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'PUBLISH_FAILED',
          metadata: expect.objectContaining({
            system: 'scheduler',
            reason: 'REVISION_MISMATCH',
          }),
        }),
        mockTx,
      );
      expect(notificationsService.createForEventSafely).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({
          type: NotificationType.ARTICLE_FAILED_TO_PUBLISH,
          dedupeKey: 'article-publish-failed:sched-1',
          data: { scheduleId: 'sched-1', reason: 'REVISION_MISMATCH' },
        }),
      );
      expect(notificationsService.createForEventSafely).toHaveBeenCalledTimes(1);
      expect(emailDispatchService.dispatchEmailsSafely).toHaveBeenCalledWith(['notification-1']);
    });

    it('should notify once on approved revision not found after commit', async () => {
      mockTx.$queryRaw
        .mockResolvedValueOnce([
          {
            id: 'sched-1',
            articleId: 'art-1',
            status: 'PENDING',
            expectedArticleVersion: 3,
            approvedRevisionId: 'rev-1',
            scheduledFor: new Date(),
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 'art-1',
            status: 'SCHEDULED',
            version: 3,
            primaryAuthorId: 'author-1',
            currentRevisionId: 'rev-1',
            approvedRevisionId: 'rev-1',
          },
        ]);
      mockTx.articleRevision.findUnique.mockResolvedValue({
        id: 'rev-1',
        articleId: 'other-article',
      });
      mockTx.article.update.mockResolvedValue({
        id: 'art-1',
        status: 'FAILED_TO_PUBLISH',
        version: 4,
      });

      await expect(service.executeScheduledPublish('sched-1')).rejects.toThrow(
        'APPROVED_REVISION_NOT_FOUND',
      );

      expect(notificationsService.createForEventSafely).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({
          type: NotificationType.ARTICLE_FAILED_TO_PUBLISH,
          dedupeKey: 'article-publish-failed:sched-1',
          data: { scheduleId: 'sched-1', reason: 'APPROVED_REVISION_NOT_FOUND' },
        }),
      );
      expect(notificationsService.createForEventSafely).toHaveBeenCalledTimes(1);
      expect(emailDispatchService.dispatchEmailsSafely).toHaveBeenCalledWith(['notification-1']);
    });

    it('should successfully publish scheduled article and record SCHEDULE_MISSED if delayed', async () => {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60000);
      mockTx.$queryRaw
        .mockResolvedValueOnce([
          {
            id: 'sched-1',
            articleId: 'art-1',
            status: 'PENDING',
            expectedArticleVersion: 3,
            approvedRevisionId: 'rev-1',
            scheduledFor: tenMinutesAgo,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 'art-1',
            status: 'SCHEDULED',
            version: 3,
            approvedRevisionId: 'rev-1',
            currentPublishedRevisionId: null,
          },
        ]);

      mockTx.articleRevision.findUnique.mockResolvedValue({
        id: 'rev-1',
        articleId: 'art-1',
      });

      mockTx.article.update.mockResolvedValue({
        id: 'art-1',
        status: 'PUBLISHED',
        currentPublishedRevisionId: 'rev-1',
        version: 4,
      });

      const published = await service.executeScheduledPublish('sched-1');

      expect(published?.status).toBe('PUBLISHED');
      expect(mockTx.publicationSchedule.updateMany).toHaveBeenCalledWith({
        where: { id: 'sched-1', status: 'PENDING' },
        data: { status: 'EXECUTED' },
      });

      // Both SCHEDULE_MISSED and PUBLISH audit events should be logged
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'SCHEDULE_MISSED',
          entityId: 'art-1',
          metadata: expect.objectContaining({ system: 'scheduler' }),
        }),
        mockTx,
      );

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'PUBLISH',
          entityId: 'art-1',
          metadata: expect.objectContaining({ system: 'scheduler', scheduleId: 'sched-1' }),
        }),
        mockTx,
      );
    });
  });

  describe('Reopening FAILED_TO_PUBLISH to DRAFT', () => {
    it('should reopen a FAILED_TO_PUBLISH article to DRAFT through WorkflowService', async () => {
      mockTx.article.findUnique.mockResolvedValue({
        id: 'art-failed',
        status: 'FAILED_TO_PUBLISH',
        primaryAuthorId: mockUser.sub,
        version: 5,
        approvedRevisionId: 'rev-1',
        scheduledFor: new Date(),
      });
      mockTx.$queryRaw.mockResolvedValue([
        { id: 'art-failed', status: 'FAILED_TO_PUBLISH', deletedAt: null },
      ]);

      mockTx.article.update.mockResolvedValue({
        id: 'art-failed',
        status: 'DRAFT',
        approvedRevisionId: null,
        scheduledFor: null,
        version: 6,
      });

      const reopened = await service.reopenDraft('art-failed', mockUser, 5);

      expect(reopened.status).toBe('DRAFT');
      expect(mockTx.article.update).toHaveBeenCalledWith({
        where: { id: 'art-failed' },
        data: expect.objectContaining({
          status: 'DRAFT',
          approvedRevisionId: null,
          scheduledFor: null,
          version: { increment: 1 },
        }),
      });

      expect(mockTx.publicationSchedule.updateMany).toHaveBeenCalledWith({
        where: { articleId: 'art-failed', status: 'PENDING' },
        data: { status: 'CANCELLED', lastError: 'Reopened to DRAFT' },
      });

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ARTICLE_RESET_TO_DRAFT',
          entityId: 'art-failed',
          actorId: mockUser.sub,
        }),
        mockTx,
      );
    });

    it('should reject reopening if article is not in a valid terminal or scheduled state', async () => {
      mockTx.article.findUnique.mockResolvedValue({
        id: 'art-pub',
        status: 'PUBLISHED',
        primaryAuthorId: mockUser.sub,
        version: 5,
      });

      await expect(service.reopenDraft('art-pub', mockUser, 5)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should enforce concurrency version check on reopen', async () => {
      mockTx.article.findUnique.mockResolvedValue({
        id: 'art-failed',
        status: 'FAILED_TO_PUBLISH',
        primaryAuthorId: mockUser.sub,
        version: 6, // current version is 6
      });

      // Expected version 5 -> mismatch!
      await expect(service.reopenDraft('art-failed', mockUser, 5)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should not reopen an article that was published after the initial read', async () => {
      mockTx.article.findUnique.mockResolvedValue({
        id: 'art-failed',
        status: 'FAILED_TO_PUBLISH',
        primaryAuthorId: mockUser.sub,
        version: 5,
      });
      mockTx.$queryRaw.mockResolvedValue([
        { id: 'art-failed', status: 'PUBLISHED', deletedAt: null },
      ]);

      await expect(service.reopenDraft('art-failed', mockUser, 5)).rejects.toThrow(
        'Article state changed while reopening to DRAFT',
      );

      expect(mockTx.article.update).not.toHaveBeenCalled();
      expect(mockTx.publicationSchedule.updateMany).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
    });
  });

  describe('Stale schedule reconciliation', () => {
    const scheduleRow = (overrides: any = {}) => ({
      id: 'sched-1',
      articleId: 'art-1',
      status: 'PENDING',
      expectedArticleVersion: 2,
      approvedRevisionId: 'rev-1',
      scheduledFor: new Date(),
      ...overrides,
    });

    const articleRow = (overrides: any = {}) => ({
      id: 'art-1',
      status: 'SCHEDULED',
      version: 2,
      approvedRevisionId: 'rev-1',
      currentPublishedRevisionId: null,
      deletedAt: null,
      ...overrides,
    });

    it.each(['DRAFT', 'APPROVED', 'ARCHIVED'])(
      'cancels an orphan PENDING schedule when the article is %s',
      async (status) => {
        mockTx.$queryRaw
          .mockResolvedValueOnce([scheduleRow()])
          .mockResolvedValueOnce([articleRow({ status })]);

        await expect(service.executeScheduledPublish('sched-1')).rejects.toThrow(
          'Article no longer SCHEDULED',
        );

        expect(mockTx.publicationSchedule.updateMany).toHaveBeenCalledWith({
          where: { id: 'sched-1', status: 'PENDING' },
          data: { status: 'CANCELLED', lastError: 'Article no longer SCHEDULED' },
        });
        expect(mockTx.article.update).not.toHaveBeenCalled();
        expect(auditService.log).not.toHaveBeenCalled();
      },
    );

    it('cancels an orphan PENDING schedule for a soft-deleted article without mutating it', async () => {
      mockTx.$queryRaw
        .mockResolvedValueOnce([scheduleRow()])
        .mockResolvedValueOnce([articleRow({ deletedAt: new Date() })]);

      await expect(service.executeScheduledPublish('sched-1')).rejects.toThrow('Article deleted');

      expect(mockTx.publicationSchedule.updateMany).toHaveBeenCalledWith({
        where: { id: 'sched-1', status: 'PENDING' },
        data: { status: 'CANCELLED', lastError: 'Article deleted' },
      });
      expect(mockTx.article.update).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
    });

    it('reconciles a PENDING schedule to EXECUTED when the intended revision is already published', async () => {
      mockTx.$queryRaw
        .mockResolvedValueOnce([scheduleRow()])
        .mockResolvedValueOnce([
          articleRow({ status: 'PUBLISHED', currentPublishedRevisionId: 'rev-1' }),
        ]);

      const result = await service.executeScheduledPublish('sched-1');

      expect(result?.status).toBe('PUBLISHED');
      expect(mockTx.publicationSchedule.updateMany).toHaveBeenCalledWith({
        where: { id: 'sched-1', status: 'PENDING' },
        data: { status: 'EXECUTED' },
      });
      expect(mockTx.article.update).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
    });

    it('cancels a PENDING schedule when the article is published with a different revision', async () => {
      mockTx.$queryRaw
        .mockResolvedValueOnce([scheduleRow()])
        .mockResolvedValueOnce([
          articleRow({ status: 'PUBLISHED', currentPublishedRevisionId: 'rev-other' }),
        ]);

      await expect(service.executeScheduledPublish('sched-1')).rejects.toThrow(
        'Article already published with a different revision',
      );

      expect(mockTx.publicationSchedule.updateMany).toHaveBeenCalledWith({
        where: { id: 'sched-1', status: 'PENDING' },
        data: {
          status: 'CANCELLED',
          lastError: 'Article already published with a different revision',
        },
      });
      expect(mockTx.article.update).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
    });

    it('does not write anything when the schedule itself is missing', async () => {
      mockTx.$queryRaw.mockResolvedValueOnce([]);

      await expect(service.executeScheduledPublish('sched-missing')).rejects.toThrow(
        'Schedule sched-missing not found',
      );

      expect(mockTx.publicationSchedule.updateMany).not.toHaveBeenCalled();
      expect(mockTx.article.update).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
    });

    it('cancels an orphan schedule when the Article row no longer exists', async () => {
      mockTx.$queryRaw.mockResolvedValueOnce([scheduleRow()]).mockResolvedValueOnce([]);

      await expect(service.executeScheduledPublish('sched-1')).rejects.toThrow('Article not found');

      expect(mockTx.publicationSchedule.updateMany).toHaveBeenCalledWith({
        where: { id: 'sched-1', status: 'PENDING' },
        data: { status: 'CANCELLED', lastError: 'Article not found' },
      });
      expect(mockTx.article.update).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
    });
  });

  describe('recordTerminalFailure concurrency safety', () => {
    const scheduleRow = (overrides: any = {}) => ({
      id: 'sched-1',
      articleId: 'art-1',
      status: 'PENDING',
      approvedRevisionId: 'rev-1',
      ...overrides,
    });

    const articleRow = (overrides: any = {}) => ({
      id: 'art-1',
      status: 'SCHEDULED',
      version: 2,
      approvedRevisionId: 'rev-1',
      currentPublishedRevisionId: null,
      deletedAt: null,
      ...overrides,
    });

    it.each(['CANCELLED', 'EXECUTED', 'FAILED'])(
      'never overwrites a schedule that is already %s',
      async (status) => {
        mockTx.$queryRaw.mockResolvedValueOnce([scheduleRow({ status })]);

        const result = await service.recordTerminalFailure('sched-1', 'Late failure report');

        expect(result).toBeNull();
        expect(mockTx.publicationSchedule.updateMany).not.toHaveBeenCalled();
        expect(mockTx.article.update).not.toHaveBeenCalled();
        expect(auditService.log).not.toHaveBeenCalled();
        expect(notificationsService.createForEventSafely).not.toHaveBeenCalled();
        expect(emailDispatchService.dispatchEmailsSafely).not.toHaveBeenCalled();
      },
    );

    it('cancels instead of failing when the article has left SCHEDULED', async () => {
      mockTx.$queryRaw
        .mockResolvedValueOnce([scheduleRow()])
        .mockResolvedValueOnce([articleRow({ status: 'DRAFT' })]);

      const result = await service.recordTerminalFailure('sched-1', 'Max retries exhausted');

      expect(result).toBeNull();
      expect(mockTx.publicationSchedule.updateMany).toHaveBeenCalledWith({
        where: { id: 'sched-1', status: 'PENDING' },
        data: { status: 'CANCELLED', lastError: 'Article no longer SCHEDULED' },
      });
      expect(mockTx.article.update).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
    });

    it('cancels instead of failing when the article is soft-deleted', async () => {
      mockTx.$queryRaw
        .mockResolvedValueOnce([scheduleRow()])
        .mockResolvedValueOnce([articleRow({ deletedAt: new Date() })]);

      await service.recordTerminalFailure('sched-1', 'Max retries exhausted');

      expect(mockTx.publicationSchedule.updateMany).toHaveBeenCalledWith({
        where: { id: 'sched-1', status: 'PENDING' },
        data: { status: 'CANCELLED', lastError: 'Article deleted' },
      });
      expect(mockTx.article.update).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
    });

    it('reconciles to EXECUTED when the intended revision is already published', async () => {
      mockTx.$queryRaw
        .mockResolvedValueOnce([scheduleRow()])
        .mockResolvedValueOnce([
          articleRow({ status: 'PUBLISHED', currentPublishedRevisionId: 'rev-1' }),
        ]);

      await service.recordTerminalFailure('sched-1', 'Max retries exhausted');

      expect(mockTx.publicationSchedule.updateMany).toHaveBeenCalledWith({
        where: { id: 'sched-1', status: 'PENDING' },
        data: { status: 'EXECUTED' },
      });
      expect(mockTx.article.update).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
    });

    it('records a genuine terminal failure only while the article is SCHEDULED', async () => {
      mockTx.$queryRaw
        .mockResolvedValueOnce([scheduleRow()])
        .mockResolvedValueOnce([articleRow()]);
      mockTx.article.update.mockResolvedValue({
        id: 'art-1',
        status: 'FAILED_TO_PUBLISH',
        version: 3,
      });

      const result = await service.recordTerminalFailure('sched-1', 'Max retries exhausted');

      expect(result?.status).toBe('FAILED_TO_PUBLISH');
      expect(mockTx.publicationSchedule.updateMany).toHaveBeenCalledWith({
        where: { id: 'sched-1', status: 'PENDING' },
        data: { status: 'FAILED', lastError: 'Max retries exhausted' },
      });
      expect(mockTx.article.update).toHaveBeenCalledWith({
        where: { id: 'art-1' },
        data: { status: 'FAILED_TO_PUBLISH', version: { increment: 1 } },
      });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'PUBLISH_FAILED',
          entityId: 'art-1',
          metadata: expect.objectContaining({
            system: 'scheduler',
            scheduleId: 'sched-1',
            reason: 'Max retries exhausted',
          }),
        }),
        mockTx,
      );

      expect(notificationsService.createForEventSafely).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({
          type: NotificationType.ARTICLE_FAILED_TO_PUBLISH,
          articleId: 'art-1',
          actorId: null,
          dedupeKey: 'article-publish-failed:sched-1',
          data: { scheduleId: 'sched-1', reason: 'Max retries exhausted' },
        }),
      );
      expect(emailDispatchService.dispatchEmailsSafely).toHaveBeenCalledWith(['notification-1']);

      // The schedule must be conditionally terminalized before the Article moves.
      const scheduleOrder = (mockTx.publicationSchedule.updateMany as jest.Mock).mock
        .invocationCallOrder[0];
      const articleOrder = (mockTx.article.update as jest.Mock).mock.invocationCallOrder[0];
      expect(scheduleOrder).toBeLessThan(articleOrder);
    });

    it('does not move the Article when the conditional schedule update lost the race', async () => {
      mockTx.$queryRaw
        .mockResolvedValueOnce([scheduleRow()])
        .mockResolvedValueOnce([articleRow()]);
      mockTx.publicationSchedule.updateMany.mockResolvedValueOnce({ count: 0 });

      const result = await service.recordTerminalFailure('sched-1', 'Max retries exhausted');

      expect(result).toBeNull();
      expect(mockTx.article.update).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
    });

    it('cancels an orphan schedule when the Article row no longer exists', async () => {
      mockTx.$queryRaw.mockResolvedValueOnce([scheduleRow()]).mockResolvedValueOnce([]);

      await service.recordTerminalFailure('sched-1', 'Max retries exhausted');

      expect(mockTx.publicationSchedule.updateMany).toHaveBeenCalledWith({
        where: { id: 'sched-1', status: 'PENDING' },
        data: { status: 'CANCELLED', lastError: 'Article not found' },
      });
      expect(mockTx.article.update).not.toHaveBeenCalled();
    });
  });
});
