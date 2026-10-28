import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { NotificationEmailReconciler } from './notification-email.reconciler';
import { NOTIFICATION_EMAIL_JOB, NotificationEmailJobData } from './email.constants';

jest.mock('../../../database/client', () => ({
  prisma: {
    notification: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

import { prisma } from '../../../database/client';

const notificationDelegate = prisma.notification as unknown as {
  findMany: jest.Mock;
  updateMany: jest.Mock;
};

function buildConfig(values: Record<string, unknown> = {}): ConfigService {
  return {
    get: jest.fn((key: string, fallback?: unknown) => (key in values ? values[key] : fallback)),
  } as unknown as ConfigService;
}

function buildQueue() {
  return {
    add: jest.fn().mockResolvedValue(undefined),
    getJob: jest.fn().mockResolvedValue(null),
  };
}

function notificationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'notification-1',
    type: 'ARTICLE_APPROVED',
    recipientId: 'user-1',
    emailAttempts: 0,
    emailLastError: null,
    recipient: { email: 'author@dailystar.local', isActive: true },
    ...overrides,
  };
}

function buildJob(state: string, overrides: Record<string, unknown> = {}) {
  return {
    getState: jest.fn().mockResolvedValue(state),
    attemptsMade: 0,
    opts: { attempts: 5 },
    failedReason: 'provider failure',
    remove: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('NotificationEmailReconciler', () => {
  let reconciler: NotificationEmailReconciler;
  let queue: ReturnType<typeof buildQueue>;
  let config: ConfigService;

  function createReconciler(values: Record<string, unknown> = {}): void {
    config = buildConfig(values);
    reconciler = new NotificationEmailReconciler(
      queue as unknown as Queue<NotificationEmailJobData>,
      config,
    );
  }

  beforeEach(() => {
    queue = buildQueue();
    createReconciler();
    jest.clearAllMocks();
    notificationDelegate.findMany.mockResolvedValue([]);
    notificationDelegate.updateMany.mockResolvedValue({ count: 1 });
  });

  it('does nothing when EMAIL_RECONCILE_ENABLED=false', async () => {
    createReconciler({ 'notifications.email.reconcileEnabled': false });

    await reconciler.reconcile();

    expect(notificationDelegate.findMany).not.toHaveBeenCalled();
    expect(queue.getJob).not.toHaveBeenCalled();
  });

  it('selects a bounded batch of stale PENDING rows', async () => {
    await reconciler.reconcile();

    expect(notificationDelegate.findMany).toHaveBeenCalledWith({
      where: {
        emailStatus: 'PENDING',
        createdAt: { lt: expect.any(Date) },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 200,
      select: {
        id: true,
        type: true,
        recipientId: true,
        emailAttempts: true,
        emailLastError: true,
        recipient: { select: { email: true, isActive: true } },
      },
    });
  });

  it('honours configured batch size and staleness', async () => {
    createReconciler({
      'notifications.email.reconcileBatchSize': 25,
      'notifications.email.reconcileStaleMinutes': 1,
    });

    await reconciler.reconcile();

    const args = notificationDelegate.findMany.mock.calls[0][0];
    expect(args.take).toBe(25);
    const cutoff = args.where.createdAt.lt as Date;
    expect(Date.now() - cutoff.getTime()).toBeGreaterThanOrEqual(59_000);
  });

  it('marks a PENDING row SENT from completed job evidence, even for a now-inactive recipient', async () => {
    notificationDelegate.findMany.mockResolvedValue([
      notificationRow({ recipient: { email: 'author@dailystar.local', isActive: false } }),
    ]);
    queue.getJob.mockResolvedValue(buildJob('completed'));

    await reconciler.reconcile();

    expect(notificationDelegate.updateMany).toHaveBeenCalledWith({
      where: { id: 'notification-1', emailStatus: 'PENDING' },
      data: { emailStatus: 'SENT', emailSentAt: expect.any(Date) },
    });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it.each(['waiting', 'delayed', 'active'])(
    'leaves PENDING and the %s job untouched, even if the recipient is inactive',
    async (state) => {
      const job = buildJob(state);
      notificationDelegate.findMany.mockResolvedValue([
        notificationRow({ recipient: { email: 'author@dailystar.local', isActive: false } }),
      ]);
      queue.getJob.mockResolvedValue(job);

      await reconciler.reconcile();

      expect(notificationDelegate.updateMany).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
      expect(job.remove).not.toHaveBeenCalled();
    },
  );

  it('leaves a failed job with retries remaining PENDING and untouched', async () => {
    const job = buildJob('failed', { attemptsMade: 2, opts: { attempts: 5 } });
    notificationDelegate.findMany.mockResolvedValue([notificationRow()]);
    queue.getJob.mockResolvedValue(job);

    await reconciler.reconcile();

    expect(notificationDelegate.updateMany).not.toHaveBeenCalled();
    expect(job.remove).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('marks an exhausted eligible delivery FAILED with the last failure reason', async () => {
    const job = buildJob('failed', {
      attemptsMade: 5,
      opts: { attempts: 5 },
      failedReason: 'Postmark email delivery failed with HTTP 503',
    });
    notificationDelegate.findMany.mockResolvedValue([notificationRow()]);
    queue.getJob.mockResolvedValue(job);

    await reconciler.reconcile();

    expect(notificationDelegate.updateMany).toHaveBeenCalledWith({
      where: { id: 'notification-1', emailStatus: 'PENDING' },
      data: {
        emailStatus: 'FAILED',
        emailLastError: 'Postmark email delivery failed with HTTP 503',
      },
    });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('marks an exhausted ineligible delivery SKIPPED', async () => {
    queue.getJob.mockResolvedValue(buildJob('failed', { attemptsMade: 5 }));
    notificationDelegate.findMany.mockResolvedValue([
      notificationRow({ recipient: { email: 'author@dailystar.local', isActive: false } }),
    ]);

    await reconciler.reconcile();

    expect(notificationDelegate.updateMany).toHaveBeenCalledWith({
      where: { id: 'notification-1', emailStatus: 'PENDING' },
      data: { emailStatus: 'SKIPPED' },
    });
  });

  it('marks a missing job with an inactive recipient SKIPPED and does not enqueue', async () => {
    notificationDelegate.findMany.mockResolvedValue([
      notificationRow({ recipient: { email: 'author@dailystar.local', isActive: false } }),
    ]);
    queue.getJob.mockResolvedValue(null);

    await reconciler.reconcile();

    expect(notificationDelegate.updateMany).toHaveBeenCalledWith({
      where: { id: 'notification-1', emailStatus: 'PENDING' },
      data: { emailStatus: 'SKIPPED' },
    });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('marks a missing job with no email address SKIPPED', async () => {
    notificationDelegate.findMany.mockResolvedValue([
      notificationRow({ recipient: { email: '', isActive: true } }),
    ]);
    queue.getJob.mockResolvedValue(null);

    await reconciler.reconcile();

    expect(notificationDelegate.updateMany).toHaveBeenCalledWith({
      where: { id: 'notification-1', emailStatus: 'PENDING' },
      data: { emailStatus: 'SKIPPED' },
    });
  });

  it('enqueues a missing job for an eligible recipient with attempts remaining', async () => {
    notificationDelegate.findMany.mockResolvedValue([notificationRow({ emailAttempts: 3 })]);
    queue.getJob.mockResolvedValue(null);

    await reconciler.reconcile();

    expect(queue.add).toHaveBeenCalledWith(
      NOTIFICATION_EMAIL_JOB,
      { notificationId: 'notification-1' },
      { jobId: 'notification-1' },
    );
    expect(notificationDelegate.updateMany).not.toHaveBeenCalled();
  });

  it('marks a missing job FAILED when an eligible recipient has exhausted attempts', async () => {
    notificationDelegate.findMany.mockResolvedValue([
      notificationRow({ emailAttempts: 5, emailLastError: 'last provider failure' }),
    ]);
    queue.getJob.mockResolvedValue(null);

    await reconciler.reconcile();

    expect(notificationDelegate.updateMany).toHaveBeenCalledWith({
      where: { id: 'notification-1', emailStatus: 'PENDING' },
      data: { emailStatus: 'FAILED', emailLastError: 'last provider failure' },
    });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('uses the configured max attempts for missing-job exhaustion', async () => {
    createReconciler({ 'notifications.email.maxAttempts': 2 });
    notificationDelegate.findMany.mockResolvedValue([
      notificationRow({ emailAttempts: 2, emailLastError: null }),
    ]);
    queue.getJob.mockResolvedValue(null);

    await reconciler.reconcile();

    expect(notificationDelegate.updateMany).toHaveBeenCalledWith({
      where: { id: 'notification-1', emailStatus: 'PENDING' },
      data: {
        emailStatus: 'FAILED',
        emailLastError: 'Email delivery attempts exhausted',
      },
    });
  });

  it('leaves the row PENDING without incrementing attempts when Redis is unavailable', async () => {
    notificationDelegate.findMany.mockResolvedValue([notificationRow()]);
    queue.getJob.mockRejectedValue(new Error('Redis connection refused'));

    await reconciler.reconcile();

    expect(notificationDelegate.updateMany).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('leaves the row PENDING when job-state inspection is inconclusive', async () => {
    const job = buildJob('waiting');
    job.getState.mockRejectedValue(new Error('Redis timeout'));
    notificationDelegate.findMany.mockResolvedValue([notificationRow()]);
    queue.getJob.mockResolvedValue(job);

    await reconciler.reconcile();

    expect(notificationDelegate.updateMany).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('leaves the row PENDING for an unrecognised job state', async () => {
    notificationDelegate.findMany.mockResolvedValue([notificationRow()]);
    queue.getJob.mockResolvedValue(buildJob('paused'));

    await reconciler.reconcile();

    expect(notificationDelegate.updateMany).not.toHaveBeenCalled();
  });

  it('does not throw or overwrite when a conditional transition matches zero rows', async () => {
    notificationDelegate.findMany.mockResolvedValue([notificationRow()]);
    queue.getJob.mockResolvedValue(buildJob('completed'));
    notificationDelegate.updateMany.mockResolvedValue({ count: 0 });

    await expect(reconciler.reconcile()).resolves.toBeUndefined();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('defers to the next sweep when a missing job cannot be enqueued', async () => {
    notificationDelegate.findMany.mockResolvedValue([notificationRow()]);
    queue.getJob.mockResolvedValue(null);
    queue.add.mockRejectedValue(new Error('Redis connection refused'));

    await expect(reconciler.reconcile()).resolves.toBeUndefined();

    expect(notificationDelegate.updateMany).not.toHaveBeenCalled();
  });

  it('removes a retained failed blocking job after verifying removal, then re-adds once', async () => {
    const blockingJob = buildJob('failed', { attemptsMade: 5 });
    notificationDelegate.findMany.mockResolvedValue([notificationRow()]);
    queue.getJob
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(blockingJob)
      .mockResolvedValueOnce(null);
    queue.add
      .mockRejectedValueOnce(new Error('job already exists'))
      .mockResolvedValueOnce(undefined);

    await reconciler.reconcile();

    expect(blockingJob.remove).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(notificationDelegate.updateMany).not.toHaveBeenCalled();
  });

  it('never removes a live blocking job during the repair path', async () => {
    const blockingJob = buildJob('waiting');
    notificationDelegate.findMany.mockResolvedValue([notificationRow()]);
    queue.getJob.mockResolvedValueOnce(null).mockResolvedValueOnce(blockingJob);
    queue.add.mockRejectedValueOnce(new Error('job already exists'));

    await reconciler.reconcile();

    expect(blockingJob.remove).not.toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(notificationDelegate.updateMany).not.toHaveBeenCalled();
  });

  it('never removes a completed blocking job during the repair path', async () => {
    const blockingJob = buildJob('completed');
    notificationDelegate.findMany.mockResolvedValue([notificationRow()]);
    queue.getJob.mockResolvedValueOnce(null).mockResolvedValueOnce(blockingJob);
    queue.add.mockRejectedValueOnce(new Error('job already exists'));

    await reconciler.reconcile();

    expect(blockingJob.remove).not.toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(notificationDelegate.updateMany).not.toHaveBeenCalled();
  });

  it('continues the batch when one row throws unexpectedly', async () => {
    notificationDelegate.findMany.mockResolvedValue([
      notificationRow({ id: 'notification-1' }),
      notificationRow({ id: 'notification-2' }),
    ]);
    queue.getJob
      .mockRejectedValueOnce(new Error('Redis down'))
      .mockResolvedValueOnce(buildJob('completed'));

    await reconciler.reconcile();

    expect(notificationDelegate.updateMany).toHaveBeenCalledWith({
      where: { id: 'notification-2', emailStatus: 'PENDING' },
      data: { emailStatus: 'SENT', emailSentAt: expect.any(Date) },
    });
  });
});
