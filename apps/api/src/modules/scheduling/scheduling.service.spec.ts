import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SchedulingService } from './scheduling.service';
import { WorkflowService } from '../workflow/workflow.service';
import { getQueueToken } from '@nestjs/bullmq';

jest.mock('../../database/client', () => ({
  prisma: {
    publicationSchedule: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    article: {
      findUnique: jest.fn(),
    },
  },
}));

import { prisma } from '../../database/client';

const article = (overrides: any = {}) => ({
  id: 'art-1',
  status: 'SCHEDULED',
  version: 2,
  approvedRevisionId: 'rev-1',
  currentPublishedRevisionId: null,
  deletedAt: null,
  ...overrides,
});

const schedule = (overrides: any = {}) => ({
  id: 'sched-1',
  articleId: 'art-1',
  scheduledFor: new Date(Date.now() + 10 * 60000),
  status: 'PENDING',
  attempts: 0,
  expectedArticleVersion: 2,
  approvedRevisionId: 'rev-1',
  article: article(),
  ...overrides,
});

describe('SchedulingService (Unit)', () => {
  let service: SchedulingService;
  let mockQueue: any;
  let mockWorkflowService: any;

  beforeEach(async () => {
    jest.clearAllMocks();

    (prisma.publicationSchedule.findMany as jest.Mock).mockReset();
    (prisma.publicationSchedule.findUnique as jest.Mock).mockReset();
    (prisma.publicationSchedule.updateMany as jest.Mock)
      .mockReset()
      .mockResolvedValue({ count: 1 });

    mockQueue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
      getJob: jest.fn(),
    };

    mockWorkflowService = {
      executeScheduledPublish: jest.fn(),
      recordTerminalFailure: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SchedulingService,
        {
          provide: getQueueToken('article-publishing'),
          useValue: mockQueue,
        },
        {
          provide: WorkflowService,
          useValue: mockWorkflowService,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((_key: string, defaultValue: any) => defaultValue),
          },
        },
      ],
    }).compile();

    service = module.get<SchedulingService>(SchedulingService);
  });

  describe('enqueuePublishJob & removePublishJob', () => {
    it('should enqueue publish job with deterministic jobId and remaining delay', async () => {
      const scheduledFor = new Date(Date.now() + 60000);
      await service.enqueuePublishJob('sched-1', 'art-1', 2, scheduledFor);

      expect(mockQueue.add).toHaveBeenCalledWith(
        'publish-article',
        { scheduleId: 'sched-1', articleId: 'art-1', expectedVersion: 2 },
        expect.objectContaining({ jobId: 'sched-1' }),
      );
    });

    it('should gracefully handle job removal failure without throwing', async () => {
      mockQueue.getJob.mockRejectedValue(new Error('Redis connection down'));
      await expect(service.removePublishJob('sched-1')).resolves.not.toThrow();
    });
  });

  describe('safetySweep', () => {
    it('should do nothing if no pending schedules found', async () => {
      (prisma.publicationSchedule.findMany as jest.Mock).mockResolvedValue([]);

      await service.safetySweep();

      expect(mockQueue.getJob).not.toHaveBeenCalled();
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('should repair missing future job preserving remaining delay without counting a recovery attempt', async () => {
      const futureTime = new Date(Date.now() + 10 * 60000);
      (prisma.publicationSchedule.findMany as jest.Mock).mockResolvedValue([
        schedule({ id: 'sched-future', scheduledFor: futureTime }),
      ]);

      mockQueue.getJob.mockResolvedValue(null); // Missing job!

      await service.safetySweep();

      expect(mockQueue.getJob).toHaveBeenCalledWith('sched-future');
      expect(mockQueue.add).toHaveBeenCalledWith(
        'publish-article',
        { scheduleId: 'sched-future', articleId: 'art-1', expectedVersion: 2 },
        expect.objectContaining({
          jobId: 'sched-future',
          delay: expect.any(Number),
        }),
      );

      const callArgs = mockQueue.add.mock.calls[0];
      expect(callArgs[2].delay).toBeGreaterThan(500000);
      expect(prisma.publicationSchedule.updateMany).not.toHaveBeenCalled();
    });

    it('should repair an overdue missing job immediately and increment the recovery counter atomically', async () => {
      const pastTime = new Date(Date.now() - 5 * 60000);
      (prisma.publicationSchedule.findMany as jest.Mock).mockResolvedValue([
        schedule({ id: 'sched-past', scheduledFor: pastTime }),
      ]);
      (prisma.publicationSchedule.findUnique as jest.Mock).mockResolvedValue({
        attempts: 1,
        status: 'PENDING',
      });

      mockQueue.getJob.mockResolvedValue(null);

      await service.safetySweep();

      expect(prisma.publicationSchedule.updateMany).toHaveBeenCalledWith({
        where: { id: 'sched-past', status: 'PENDING' },
        data: { attempts: { increment: 1 } },
      });
      expect(mockQueue.add).toHaveBeenCalledWith(
        'publish-article',
        { scheduleId: 'sched-past', articleId: 'art-1', expectedVersion: 2 },
        expect.objectContaining({
          jobId: 'sched-past',
          delay: 0,
        }),
      );
    });

    it.each(['delayed', 'waiting', 'active'])(
      'should NOT re-enqueue if the existing job is %s',
      async (state) => {
        (prisma.publicationSchedule.findMany as jest.Mock).mockResolvedValue([schedule()]);

        mockQueue.getJob.mockResolvedValue({
          getState: jest.fn().mockResolvedValue(state),
        });

        await service.safetySweep();

        expect(mockQueue.add).not.toHaveBeenCalled();
        expect(prisma.publicationSchedule.updateMany).not.toHaveBeenCalled();
      },
    );

    it('should cancel an orphan PENDING schedule when the article is no longer SCHEDULED', async () => {
      (prisma.publicationSchedule.findMany as jest.Mock).mockResolvedValue([
        schedule({ id: 'sched-stale', article: article({ status: 'DRAFT' }) }),
      ]);

      const mockJob = { remove: jest.fn().mockResolvedValue(undefined) };
      mockQueue.getJob.mockResolvedValue(mockJob);

      await service.safetySweep();

      expect(prisma.publicationSchedule.updateMany).toHaveBeenCalledWith({
        where: { id: 'sched-stale', status: 'PENDING' },
        data: { status: 'CANCELLED', lastError: 'Article no longer SCHEDULED' },
      });
      expect(mockJob.remove).toHaveBeenCalled();
      expect(mockQueue.add).not.toHaveBeenCalled();
      expect(mockWorkflowService.recordTerminalFailure).not.toHaveBeenCalled();
    });

    it('should cancel an orphan PENDING schedule when the article is soft-deleted', async () => {
      (prisma.publicationSchedule.findMany as jest.Mock).mockResolvedValue([
        schedule({ article: article({ deletedAt: new Date() }) }),
      ]);
      mockQueue.getJob.mockResolvedValue(null);

      await service.safetySweep();

      expect(prisma.publicationSchedule.updateMany).toHaveBeenCalledWith({
        where: { id: 'sched-1', status: 'PENDING' },
        data: { status: 'CANCELLED', lastError: 'Article deleted' },
      });
      expect(mockQueue.add).not.toHaveBeenCalled();
      expect(mockWorkflowService.recordTerminalFailure).not.toHaveBeenCalled();
    });

    it('should cancel an orphan PENDING schedule when the Article row is missing', async () => {
      (prisma.publicationSchedule.findMany as jest.Mock).mockResolvedValue([
        schedule({ article: null }),
      ]);
      mockQueue.getJob.mockResolvedValue(null);

      await service.safetySweep();

      expect(prisma.publicationSchedule.updateMany).toHaveBeenCalledWith({
        where: { id: 'sched-1', status: 'PENDING' },
        data: { status: 'CANCELLED', lastError: 'Article not found' },
      });
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('should reconcile a PENDING schedule to EXECUTED when the intended revision is already published', async () => {
      (prisma.publicationSchedule.findMany as jest.Mock).mockResolvedValue([
        schedule({
          article: article({
            status: 'PUBLISHED',
            currentPublishedRevisionId: 'rev-1',
          }),
        }),
      ]);
      mockQueue.getJob.mockResolvedValue(null);

      await service.safetySweep();

      expect(prisma.publicationSchedule.updateMany).toHaveBeenCalledWith({
        where: { id: 'sched-1', status: 'PENDING' },
        data: { status: 'EXECUTED' },
      });
      expect(mockQueue.add).not.toHaveBeenCalled();
      expect(mockWorkflowService.recordTerminalFailure).not.toHaveBeenCalled();
    });

    it('should cancel a PENDING schedule when a different revision is already published', async () => {
      (prisma.publicationSchedule.findMany as jest.Mock).mockResolvedValue([
        schedule({
          article: article({
            status: 'PUBLISHED',
            currentPublishedRevisionId: 'rev-other',
          }),
        }),
      ]);
      mockQueue.getJob.mockResolvedValue(null);

      await service.safetySweep();

      expect(prisma.publicationSchedule.updateMany).toHaveBeenCalledWith({
        where: { id: 'sched-1', status: 'PENDING' },
        data: {
          status: 'CANCELLED',
          lastError: 'Article already published with a different revision',
        },
      });
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('should reconcile a completed job to EXECUTED only when the intended revision is published', async () => {
      (prisma.publicationSchedule.findMany as jest.Mock).mockResolvedValue([schedule()]);
      mockQueue.getJob.mockResolvedValue({
        getState: jest.fn().mockResolvedValue('completed'),
      });
      (prisma.publicationSchedule.findUnique as jest.Mock).mockResolvedValue(
        schedule({
          article: article({
            status: 'PUBLISHED',
            currentPublishedRevisionId: 'rev-1',
          }),
        }),
      );

      await service.safetySweep();

      expect(prisma.publicationSchedule.updateMany).toHaveBeenCalledWith({
        where: { id: 'sched-1', status: 'PENDING' },
        data: { status: 'EXECUTED' },
      });
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('should cancel a completed job when the article is published with a different revision', async () => {
      (prisma.publicationSchedule.findMany as jest.Mock).mockResolvedValue([schedule()]);
      mockQueue.getJob.mockResolvedValue({
        getState: jest.fn().mockResolvedValue('completed'),
      });
      (prisma.publicationSchedule.findUnique as jest.Mock).mockResolvedValue(
        schedule({
          article: article({
            status: 'PUBLISHED',
            currentPublishedRevisionId: 'rev-other',
          }),
        }),
      );

      await service.safetySweep();

      expect(prisma.publicationSchedule.updateMany).toHaveBeenCalledWith({
        where: { id: 'sched-1', status: 'PENDING' },
        data: {
          status: 'CANCELLED',
          lastError: 'Article already published with a different revision',
        },
      });
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('should remove a completed job, verify removal, then re-enqueue a still-valid overdue schedule', async () => {
      const pastTime = new Date(Date.now() - 5 * 60000);
      (prisma.publicationSchedule.findMany as jest.Mock).mockResolvedValue([
        schedule({ scheduledFor: pastTime }),
      ]);

      const completedJob = {
        getState: jest.fn().mockResolvedValue('completed'),
        remove: jest.fn().mockResolvedValue(undefined),
      };
      mockQueue.getJob
        .mockResolvedValueOnce(completedJob) // first inspection
        .mockResolvedValueOnce(null); // removal verification

      (prisma.publicationSchedule.findUnique as jest.Mock)
        .mockResolvedValueOnce(schedule({ scheduledFor: pastTime })) // fresh state
        .mockResolvedValueOnce({ attempts: 1, status: 'PENDING' }); // counter read

      await service.safetySweep();

      expect(completedJob.remove).toHaveBeenCalled();
      expect(completedJob.remove.mock.invocationCallOrder[0]).toBeLessThan(
        mockQueue.add.mock.invocationCallOrder[0],
      );
      expect(mockQueue.add).toHaveBeenCalledWith(
        'publish-article',
        { scheduleId: 'sched-1', articleId: 'art-1', expectedVersion: 2 },
        expect.objectContaining({ jobId: 'sched-1', delay: 0 }),
      );
      expect(prisma.publicationSchedule.updateMany).toHaveBeenCalledWith({
        where: { id: 'sched-1', status: 'PENDING' },
        data: { attempts: { increment: 1 } },
      });
    });

    it('should not add a replacement when completed-job removal fails', async () => {
      (prisma.publicationSchedule.findMany as jest.Mock).mockResolvedValue([
        schedule({ scheduledFor: new Date(Date.now() - 5 * 60000) }),
      ]);
      const completedJob = {
        getState: jest.fn().mockResolvedValue('completed'),
        remove: jest.fn().mockRejectedValue(new Error('job is locked')),
      };
      mockQueue.getJob.mockResolvedValue(completedJob);
      (prisma.publicationSchedule.findUnique as jest.Mock).mockResolvedValue(
        schedule({ scheduledFor: new Date(Date.now() - 5 * 60000) }),
      );

      await service.safetySweep();

      expect(completedJob.remove).toHaveBeenCalled();
      expect(mockQueue.add).not.toHaveBeenCalled();
      expect(mockWorkflowService.recordTerminalFailure).not.toHaveBeenCalled();
    });

    it('should not add a replacement when the completed job is still present after removal', async () => {
      (prisma.publicationSchedule.findMany as jest.Mock).mockResolvedValue([
        schedule({ scheduledFor: new Date(Date.now() - 5 * 60000) }),
      ]);
      const completedJob = {
        getState: jest.fn().mockResolvedValue('completed'),
        remove: jest.fn().mockResolvedValue(undefined),
      };
      mockQueue.getJob.mockResolvedValueOnce(completedJob).mockResolvedValueOnce(completedJob); // still present
      (prisma.publicationSchedule.findUnique as jest.Mock).mockResolvedValue(
        schedule({ scheduledFor: new Date(Date.now() - 5 * 60000) }),
      );

      await service.safetySweep();

      expect(completedJob.remove).toHaveBeenCalled();
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('should bound repeated overdue recovery and invoke state-aware terminal handling', async () => {
      const pastTime = new Date(Date.now() - 5 * 60000);
      (prisma.publicationSchedule.findMany as jest.Mock).mockResolvedValue([
        schedule({ scheduledFor: pastTime, attempts: 3 }),
      ]);
      (prisma.publicationSchedule.findUnique as jest.Mock).mockResolvedValue({
        attempts: 4,
        status: 'PENDING',
      });
      mockQueue.getJob.mockResolvedValue(null);

      await service.safetySweep();

      expect(mockQueue.add).not.toHaveBeenCalled();
      expect(mockWorkflowService.recordTerminalFailure).toHaveBeenCalledWith(
        'sched-1',
        'Scheduler recovery attempts exhausted',
      );
    });

    it('should handle Redis unavailability during sweep without throwing or corrupting DB', async () => {
      (prisma.publicationSchedule.findMany as jest.Mock).mockResolvedValue([schedule()]);
      mockQueue.getJob.mockRejectedValue(new Error('Redis connection refused'));

      await expect(service.safetySweep()).resolves.not.toThrow();
      expect(prisma.publicationSchedule.updateMany).not.toHaveBeenCalled();
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('should retry failed job if attempts remain below maxAttempts', async () => {
      (prisma.publicationSchedule.findMany as jest.Mock).mockResolvedValue([schedule()]);

      const mockJob = {
        getState: jest.fn().mockResolvedValue('failed'),
        opts: { attempts: 3 },
        attemptsMade: 1,
        retry: jest.fn().mockResolvedValue(undefined),
      };
      mockQueue.getJob.mockResolvedValue(mockJob);

      await service.safetySweep();

      expect(mockJob.retry).toHaveBeenCalled();
      expect(mockWorkflowService.recordTerminalFailure).not.toHaveBeenCalled();
    });

    it('should invoke state-aware terminal failure when failed job exhausted all retry attempts', async () => {
      (prisma.publicationSchedule.findMany as jest.Mock).mockResolvedValue([schedule()]);

      const mockJob = {
        getState: jest.fn().mockResolvedValue('failed'),
        opts: { attempts: 3 },
        attemptsMade: 3,
        failedReason: 'Critical failure',
      };
      mockQueue.getJob.mockResolvedValue(mockJob);

      await service.safetySweep();

      expect(mockWorkflowService.recordTerminalFailure).toHaveBeenCalledWith(
        'sched-1',
        'Critical failure',
      );
    });

    it('should never call executeScheduledPublish directly', async () => {
      (prisma.publicationSchedule.findMany as jest.Mock).mockResolvedValue([schedule()]);
      mockQueue.getJob.mockResolvedValue(null);
      (prisma.publicationSchedule.findUnique as jest.Mock).mockResolvedValue({
        attempts: 1,
        status: 'PENDING',
      });

      await service.safetySweep();

      expect(mockWorkflowService.executeScheduledPublish).not.toHaveBeenCalled();
    });

    it('should stop completed-job reconciliation when the schedule is no longer PENDING', async () => {
      (prisma.publicationSchedule.findMany as jest.Mock).mockResolvedValue([schedule()]);
      mockQueue.getJob.mockResolvedValue({
        getState: jest.fn().mockResolvedValue('completed'),
      });
      (prisma.publicationSchedule.findUnique as jest.Mock).mockResolvedValue(
        schedule({ status: 'CANCELLED' }),
      );

      await service.safetySweep();

      expect(prisma.publicationSchedule.updateMany).not.toHaveBeenCalled();
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('should progress past the first 500-row batch and repair a missing job in a later batch', async () => {
      const baseTime = Date.now() + 10 * 60000;
      const firstBatch = Array.from({ length: 500 }, (_, index) =>
        schedule({
          id: `sched-batch-${index}`,
          scheduledFor: new Date(baseTime + index * 1000),
        }),
      );
      const beyondFirstBatch = schedule({
        id: 'sched-beyond-500',
        scheduledFor: new Date(baseTime + 500 * 1000),
      });

      (prisma.publicationSchedule.findMany as jest.Mock)
        .mockResolvedValueOnce(firstBatch)
        .mockResolvedValueOnce([beyondFirstBatch]);

      // Every schedule in the first batch has a live delayed job. The missing
      // job lives only in the second page and must still be discovered.
      mockQueue.getJob.mockImplementation(async (id: string) => {
        if (id === 'sched-beyond-500') return null;
        return { getState: jest.fn().mockResolvedValue('delayed') };
      });

      await service.safetySweep();

      expect(prisma.publicationSchedule.findMany).toHaveBeenCalledTimes(2);
      expect(prisma.publicationSchedule.findMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: { status: 'PENDING' },
          take: 500,
        }),
      );
      expect(prisma.publicationSchedule.findMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: {
            status: 'PENDING',
            OR: [
              { scheduledFor: { gt: firstBatch[499].scheduledFor } },
              { scheduledFor: firstBatch[499].scheduledFor, id: { gt: 'sched-batch-499' } },
            ],
          },
          orderBy: [{ scheduledFor: 'asc' }, { id: 'asc' }],
          take: 500,
        }),
      );
      expect(mockQueue.add).toHaveBeenCalledWith(
        'publish-article',
        { scheduleId: 'sched-beyond-500', articleId: 'art-1', expectedVersion: 2 },
        expect.objectContaining({ jobId: 'sched-beyond-500' }),
      );
    });
  });
});
