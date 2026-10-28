import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WorkflowService, TerminalPublicationError } from '../src/modules/workflow/workflow.service';
import { SchedulingService } from '../src/modules/scheduling/scheduling.service';
import { SchedulingProcessor } from '../src/modules/scheduling/scheduling.processor';
import { AuditService } from '../src/modules/audit/audit.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { EmailDispatchService } from '../src/modules/notifications/email/email-dispatch.service';
import { getQueueToken } from '@nestjs/bullmq';

const mockTx = {
  article: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  articleRevision: {
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

jest.mock('../src/database/client', () => ({
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

import { prisma } from '../src/database/client';

describe('Phase 7 Scheduling Integration Tests (Race Conditions, Recovery & Persistence)', () => {
  let workflowService: WorkflowService;
  let schedulingService: SchedulingService;
  let schedulingProcessor: SchedulingProcessor;
  let auditService: AuditService;
  let mockQueue: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockTx.$queryRaw.mockReset();
    mockTx.publicationSchedule.updateMany.mockReset();
    mockTx.publicationSchedule.updateMany.mockResolvedValue({ count: 1 });
    (prisma.publicationSchedule.findMany as jest.Mock).mockReset();
    (prisma.publicationSchedule.findUnique as jest.Mock).mockReset();
    (prisma.publicationSchedule.updateMany as jest.Mock)
      .mockReset()
      .mockResolvedValue({ count: 1 });

    mockQueue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
      getJob: jest.fn(),
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
        SchedulingService,
        SchedulingProcessor,
        {
          provide: AuditService,
          useValue: {
            log: jest.fn().mockResolvedValue({ id: 'audit-1' }),
          },
        },
        {
          provide: NotificationsService,
          useValue: {
            createForEventSafely: jest.fn().mockResolvedValue([{ id: 'notification-1' }]),
          },
        },
        {
          provide: EmailDispatchService,
          useValue: {
            dispatchEmailsSafely: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: getQueueToken('article-publishing'),
          useValue: mockQueue,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((_key: string, defaultValue: any) => defaultValue),
          },
        },
      ],
    }).compile();

    workflowService = module.get<WorkflowService>(WorkflowService);
    schedulingService = module.get<SchedulingService>(SchedulingService);
    schedulingProcessor = module.get<SchedulingProcessor>(SchedulingProcessor);
    auditService = module.get<AuditService>(AuditService);
  });

  it('1. Database commit followed by BullMQ enqueue', async () => {
    const scheduledDate = new Date(Date.now() + 10 * 60000);
    mockTx.article.findUnique.mockResolvedValue({
      id: 'art-1',
      status: 'APPROVED',
      primaryAuthorId: 'author-1',
      approvedRevisionId: 'rev-1',
      version: 1,
    });
    mockTx.article.update.mockResolvedValue({
      id: 'art-1',
      status: 'SCHEDULED',
      scheduledFor: scheduledDate,
      version: 2,
    });
    mockTx.publicationSchedule.create.mockResolvedValue({
      id: 'sched-1',
      articleId: 'art-1',
      scheduledFor: scheduledDate,
      status: 'PENDING',
      expectedArticleVersion: 2,
      approvedRevisionId: 'rev-1',
    });

    // Transaction executes first
    const result = await workflowService.schedule(
      'art-1',
      { sub: 'editor-1', permissions: ['article.schedule', 'article.read.any'] },
      1,
      scheduledDate.toISOString(),
    );
    expect(mockTx.article.update).toHaveBeenCalled();
    expect(mockTx.publicationSchedule.create).toHaveBeenCalled();

    // Post-commit enqueue
    await schedulingService.enqueuePublishJob(
      result.schedule.id,
      result.schedule.articleId,
      result.schedule.expectedArticleVersion,
      new Date(result.schedule.scheduledFor),
    );

    expect(mockQueue.add).toHaveBeenCalledWith(
      'publish-article',
      { scheduleId: 'sched-1', articleId: 'art-1', expectedVersion: 2 },
      expect.objectContaining({ jobId: 'sched-1' }),
    );
  });

  it('2. Queue enqueue failure followed by sweep recovery', async () => {
    const scheduledDate = new Date(Date.now() + 15 * 60000);
    // Queue enqueue failed initially; schedule remains PENDING in DB
    (prisma.publicationSchedule.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'sched-missing-job',
        articleId: 'art-2',
        scheduledFor: scheduledDate,
        expectedArticleVersion: 3,
        article: { id: 'art-2', status: 'SCHEDULED', version: 3 },
      },
    ]);

    mockQueue.getJob.mockResolvedValue(null); // Missing job!

    await schedulingService.safetySweep();

    expect(mockQueue.add).toHaveBeenCalledWith(
      'publish-article',
      { scheduleId: 'sched-missing-job', articleId: 'art-2', expectedVersion: 3 },
      expect.objectContaining({ jobId: 'sched-missing-job' }),
    );
  });

  it('3. Recovery of a missing job BEFORE its scheduled time, preserving its remaining delay', async () => {
    const scheduledFor = new Date(Date.now() + 12 * 60000);
    (prisma.publicationSchedule.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'sched-future-delay',
        articleId: 'art-3',
        scheduledFor,
        expectedArticleVersion: 2,
        article: { id: 'art-3', status: 'SCHEDULED', version: 2 },
      },
    ]);

    mockQueue.getJob.mockResolvedValue(null);

    await schedulingService.safetySweep();

    const addCall = mockQueue.add.mock.calls[0];
    const enqueuedDelay = addCall[2].delay;

    // Must preserve remaining delay (~12 minutes, > 650000ms)
    expect(enqueuedDelay).toBeGreaterThan(650000);
    expect(enqueuedDelay).toBeLessThanOrEqual(12 * 60000);
  });

  it('4. Duplicate enqueue using the deterministic schedule ID', async () => {
    const scheduledFor = new Date(Date.now() + 60000);
    await schedulingService.enqueuePublishJob('sched-deterministic', 'art-4', 2, scheduledFor);
    await schedulingService.enqueuePublishJob('sched-deterministic', 'art-4', 2, scheduledFor);

    expect(mockQueue.add).toHaveBeenCalledTimes(2);
    expect(mockQueue.add.mock.calls[0][2].jobId).toBe('sched-deterministic');
    expect(mockQueue.add.mock.calls[1][2].jobId).toBe('sched-deterministic');
  });

  it('5. Worker versus cancellation race (cancelled schedule aborts worker cleanly)', async () => {
    // Schedule was cancelled in DB before worker lock
    mockTx.$queryRaw.mockResolvedValueOnce([
      {
        id: 'sched-cancelled',
        articleId: 'art-5',
        status: 'CANCELLED',
      },
    ]);

    const job = { id: 'sched-cancelled', data: { scheduleId: 'sched-cancelled' } } as any;
    const result = await schedulingProcessor.process(job);

    // Aborts as terminal failure without throwing (no retry)
    expect(result).toEqual({
      status: 'terminal_failure',
      reason: expect.stringContaining('is no longer PENDING'),
    });
    expect(mockTx.article.update).not.toHaveBeenCalled();
  });

  it('6. Concurrent duplicate workers (exactly one execution succeeds)', async () => {
    // Worker 1 executes successfully
    mockTx.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'sched-dup',
          articleId: 'art-6',
          status: 'PENDING',
          expectedArticleVersion: 1,
          approvedRevisionId: 'rev-6',
          scheduledFor: new Date(),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'art-6',
          status: 'SCHEDULED',
          version: 1,
          approvedRevisionId: 'rev-6',
          currentPublishedRevisionId: null,
        },
      ]);
    mockTx.articleRevision.findUnique.mockResolvedValue({ id: 'rev-6', articleId: 'art-6' });
    mockTx.article.update.mockResolvedValue({ id: 'art-6', status: 'PUBLISHED', version: 2 });

    const worker1Result = await workflowService.executeScheduledPublish('sched-dup');
    expect(worker1Result!.status).toBe('PUBLISHED');
    expect(mockTx.publicationSchedule.updateMany).toHaveBeenCalledWith({
      where: { id: 'sched-dup', status: 'PENDING' },
      data: { status: 'EXECUTED' },
    });

    // Worker 2 runs concurrently and acquires lock after Worker 1 committed (sees EXECUTED)
    mockTx.$queryRaw.mockResolvedValueOnce([
      {
        id: 'sched-dup',
        articleId: 'art-6',
        status: 'EXECUTED', // Already EXECUTED!
      },
    ]);
    mockTx.article.findUnique.mockResolvedValue({ id: 'art-6', status: 'PUBLISHED' });

    const worker2Result = await workflowService.executeScheduledPublish('sched-dup');
    // Worker 2 completes idempotently without re-publishing
    expect(worker2Result?.status).toBe('PUBLISHED');
  });

  it('7. Sweep versus delayed-job race (sweep does not re-enqueue active/delayed jobs)', async () => {
    (prisma.publicationSchedule.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'sched-delayed',
        articleId: 'art-7',
        scheduledFor: new Date(Date.now() + 600000),
        article: { id: 'art-7', status: 'SCHEDULED' },
      },
    ]);

    mockQueue.getJob.mockResolvedValue({
      getState: jest.fn().mockResolvedValue('delayed'),
    });

    await schedulingService.safetySweep();

    expect(mockQueue.add).not.toHaveBeenCalled();
  });

  it('8. Cancellation while Redis is unavailable (DB persists and worker respects DB)', async () => {
    mockTx.article.findUnique.mockResolvedValue({
      id: 'art-8',
      status: 'SCHEDULED',
      primaryAuthorId: 'author-8',
      version: 2,
    });
    mockTx.article.update.mockResolvedValue({
      id: 'art-8',
      status: 'APPROVED',
      version: 3,
    });
    mockTx.$queryRaw.mockResolvedValue([
      { id: 'art-8', status: 'SCHEDULED', deletedAt: null },
    ]);
    mockTx.publicationSchedule.findMany.mockResolvedValue([{ id: 'sched-8' }]);

    // Redis is down during cancellation
    mockQueue.getJob.mockRejectedValue(new Error('Redis cluster down'));

    const cancelResult = await workflowService.cancelSchedule(
      'art-8',
      { sub: 'editor-1', permissions: ['article.cancel-schedule', 'article.read.any'] },
      2,
    );

    // Database changes committed successfully
    expect(cancelResult.article.status).toBe('APPROVED');
    expect(mockTx.publicationSchedule.updateMany).toHaveBeenCalledWith({
      where: { articleId: 'art-8', status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });

    // Best-effort Redis removal fails gracefully
    await expect(schedulingService.removePublishJob('sched-8')).resolves.not.toThrow();
  });

  it('9. Successful automatic publication and public visibility state', async () => {
    mockTx.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'sched-9',
          articleId: 'art-9',
          status: 'PENDING',
          expectedArticleVersion: 4,
          approvedRevisionId: 'rev-9',
          scheduledFor: new Date(),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'art-9',
          status: 'SCHEDULED',
          version: 4,
          approvedRevisionId: 'rev-9',
          currentPublishedRevisionId: null,
        },
      ]);
    mockTx.articleRevision.findUnique.mockResolvedValue({ id: 'rev-9', articleId: 'art-9' });
    mockTx.article.update.mockResolvedValue({
      id: 'art-9',
      status: 'PUBLISHED',
      publishedAt: new Date(),
      currentPublishedRevisionId: 'rev-9',
      version: 5,
    });

    const job = { id: 'sched-9', data: { scheduleId: 'sched-9' } } as any;
    const processResult = await schedulingProcessor.process(job);

    expect(processResult).toEqual({ status: 'published', articleId: 'art-9' });
    expect(mockTx.article.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PUBLISHED',
          currentPublishedRevisionId: 'rev-9',
        }),
      }),
    );
  });

  it('10. Terminal failure persistence without an accidental transaction rollback', async () => {
    mockTx.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'sched-terminal',
          articleId: 'art-10',
          status: 'PENDING',
          expectedArticleVersion: 2,
          approvedRevisionId: 'rev-10',
          scheduledFor: new Date(),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'art-10',
          status: 'SCHEDULED',
          version: 3, // Mismatch (expected 2, actual 3)
          approvedRevisionId: 'rev-10',
        },
      ]);

    mockTx.article.update.mockResolvedValue({
      id: 'art-10',
      status: 'FAILED_TO_PUBLISH',
      version: 4,
    });

    try {
      await workflowService.executeScheduledPublish('sched-terminal');
      fail('Should have thrown TerminalPublicationError');
    } catch (err: any) {
      expect(err).toBeInstanceOf(TerminalPublicationError);
      expect(err.message).toBe('VERSION_MISMATCH');
    }

    // Assert that the database updates COMMITTED inside tx and were not rolled back:
    expect(mockTx.article.update).toHaveBeenCalledWith({
      where: { id: 'art-10' },
      data: { status: 'FAILED_TO_PUBLISH', version: { increment: 1 } },
    });
    expect(mockTx.publicationSchedule.updateMany).toHaveBeenCalledWith({
      where: { id: 'sched-terminal', status: 'PENDING' },
      data: { status: 'FAILED', lastError: 'VERSION_MISMATCH' },
    });
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PUBLISH_FAILED',
        entityId: 'art-10',
        actorId: undefined,
        metadata: expect.objectContaining({
          system: 'scheduler',
          reason: 'VERSION_MISMATCH',
        }),
      }),
      mockTx,
    );
  });

  it('11. Worker cancels an orphan PENDING schedule for a soft-deleted article without a publish failure', async () => {
    mockTx.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'sched-soft-deleted',
          articleId: 'art-11',
          status: 'PENDING',
          expectedArticleVersion: 2,
          approvedRevisionId: 'rev-11',
          scheduledFor: new Date(),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'art-11',
          status: 'SCHEDULED',
          version: 2,
          approvedRevisionId: 'rev-11',
          currentPublishedRevisionId: null,
          deletedAt: new Date(),
        },
      ]);

    const job = { id: 'sched-soft-deleted', data: { scheduleId: 'sched-soft-deleted' } } as any;
    const result = await schedulingProcessor.process(job);

    expect(result).toEqual({ status: 'terminal_failure', reason: 'Article deleted' });
    expect(mockTx.publicationSchedule.updateMany).toHaveBeenCalledWith({
      where: { id: 'sched-soft-deleted', status: 'PENDING' },
      data: { status: 'CANCELLED', lastError: 'Article deleted' },
    });
    expect(mockTx.article.update).not.toHaveBeenCalled();
    expect(auditService.log).not.toHaveBeenCalled();
  });

  it('12. Sweep reconciles a completed job using the intended revision, not Article.status alone', async () => {
    (prisma.publicationSchedule.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'sched-completed',
        articleId: 'art-12',
        scheduledFor: new Date(Date.now() - 60000),
        expectedArticleVersion: 2,
        approvedRevisionId: 'rev-12',
        attempts: 0,
        status: 'PENDING',
        article: {
          id: 'art-12',
          status: 'SCHEDULED',
          version: 2,
          approvedRevisionId: 'rev-12',
          currentPublishedRevisionId: null,
          deletedAt: null,
        },
      },
    ]);
    mockQueue.getJob.mockResolvedValue({
      getState: jest.fn().mockResolvedValue('completed'),
    });
    (prisma.publicationSchedule.findUnique as jest.Mock).mockResolvedValue({
      id: 'sched-completed',
      articleId: 'art-12',
      scheduledFor: new Date(Date.now() - 60000),
      expectedArticleVersion: 2,
      approvedRevisionId: 'rev-12',
      attempts: 0,
      status: 'PENDING',
      article: {
        id: 'art-12',
        status: 'PUBLISHED',
        version: 3,
        approvedRevisionId: 'rev-12',
        currentPublishedRevisionId: 'rev-12',
        deletedAt: null,
      },
    });

    await schedulingService.safetySweep();

    expect(prisma.publicationSchedule.updateMany).toHaveBeenCalledWith({
      where: { id: 'sched-completed', status: 'PENDING' },
      data: { status: 'EXECUTED' },
    });
    expect(mockQueue.add).not.toHaveBeenCalled();
  });

  it('13. Sweep cancels a completed job when a different revision is published', async () => {
    (prisma.publicationSchedule.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'sched-completed-other',
        articleId: 'art-13',
        scheduledFor: new Date(Date.now() - 60000),
        expectedArticleVersion: 2,
        approvedRevisionId: 'rev-13',
        attempts: 0,
        status: 'PENDING',
        article: {
          id: 'art-13',
          status: 'SCHEDULED',
          version: 2,
          approvedRevisionId: 'rev-13',
          currentPublishedRevisionId: null,
          deletedAt: null,
        },
      },
    ]);
    mockQueue.getJob.mockResolvedValue({
      getState: jest.fn().mockResolvedValue('completed'),
    });
    (prisma.publicationSchedule.findUnique as jest.Mock).mockResolvedValue({
      id: 'sched-completed-other',
      articleId: 'art-13',
      scheduledFor: new Date(Date.now() - 60000),
      expectedArticleVersion: 2,
      approvedRevisionId: 'rev-13',
      attempts: 0,
      status: 'PENDING',
      article: {
        id: 'art-13',
        status: 'PUBLISHED',
        version: 3,
        approvedRevisionId: 'rev-13',
        currentPublishedRevisionId: 'rev-other',
        deletedAt: null,
      },
    });

    await schedulingService.safetySweep();

    expect(prisma.publicationSchedule.updateMany).toHaveBeenCalledWith({
      where: { id: 'sched-completed-other', status: 'PENDING' },
      data: {
        status: 'CANCELLED',
        lastError: 'Article already published with a different revision',
      },
    });
    expect(mockQueue.add).not.toHaveBeenCalled();
  });
});
