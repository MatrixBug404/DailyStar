import { randomUUID } from 'node:crypto';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import { Job, Queue, Worker } from 'bullmq';
import configuration from '../src/config/configuration';
import { createBullConnectionOptions } from '../src/config/bull-connection';
import { prisma } from '../src/database/client';
import { Prisma } from '../src/database/generated/prisma';
import { EmailDispatchService } from '../src/modules/notifications/email/email-dispatch.service';
import {
  NOTIFICATION_EMAIL_JOB,
  NOTIFICATION_EMAIL_QUEUE,
  NotificationEmailJobData,
} from '../src/modules/notifications/email/email.constants';
import { EmailProvider } from '../src/modules/notifications/email/email-provider.interface';
import { NotificationEmailProcessor } from '../src/modules/notifications/email/notification-email.processor';
import { NotificationEmailReconciler } from '../src/modules/notifications/email/notification-email.reconciler';

const STALE_CREATED_AT = () => new Date(Date.now() - 10 * 60_000);
const TEST_PREFIX = 'phase8-m3-email-e2e';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface FakeProvider {
  provider: EmailProvider;
  send: jest.Mock;
}

function fakeProvider(
  implementation?: (message: {
    to: string;
    subject: string;
    text: string;
    notificationId?: string;
  }) => Promise<void>,
): FakeProvider {
  const send = jest.fn(implementation ?? (async () => undefined));
  return { provider: { send } as EmailProvider, send };
}

describe('Notification email pipeline E2E (Phase 8 M3)', () => {
  jest.setTimeout(120_000);

  let moduleRef: TestingModule;
  let queue: Queue<NotificationEmailJobData>;
  let dispatch: EmailDispatchService;
  let reconciler: NotificationEmailReconciler;
  let connection: { host: string; port: number; password?: string };

  const activeEmail = `${TEST_PREFIX}-active-${randomUUID()}@dailystar.local`;
  const inactiveEmail = `${TEST_PREFIX}-inactive-${randomUUID()}@dailystar.local`;

  let activeUserId: string;
  let inactiveUserId: string;

  async function createNotification(
    overrides: Partial<Prisma.NotificationCreateManyInput> = {},
  ): Promise<string> {
    const id = overrides.id ?? randomUUID();
    await prisma.notification.create({
      data: {
        id,
        recipientId: activeUserId,
        type: 'ARTICLE_APPROVED',
        title: 'M3 email integration',
        body: 'Your article was approved.',
        dedupeKey: `${TEST_PREFIX}:${randomUUID()}`,
        createdAt: STALE_CREATED_AT(),
        emailStatus: 'PENDING',
        ...overrides,
      },
    });
    return id;
  }

  async function addJob(
    notificationId: string,
    overrides: { attempts?: number; backoffDelay?: number } = {},
  ) {
    return queue.add(
      NOTIFICATION_EMAIL_JOB,
      { notificationId },
      {
        jobId: notificationId,
        ...(overrides.attempts !== undefined ? { attempts: overrides.attempts } : {}),
        ...(overrides.backoffDelay !== undefined
          ? { backoff: { type: 'exponential' as const, delay: overrides.backoffDelay } }
          : {}),
      },
    );
  }

  async function waitForJobState(
    jobId: string,
    expected: string,
    timeoutMs = 10_000,
  ): Promise<Job<NotificationEmailJobData>> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const job = await queue.getJob(jobId);
      if (job && (await job.getState()) === expected) {
        return job;
      }
      await delay(50);
    }
    const current = await queue.getJob(jobId);
    const state = current ? await current.getState() : 'missing';
    throw new Error(`Timed out waiting for job ${jobId} to be ${expected}; state=${state}`);
  }

  async function processWithWorker(
    jobId: string,
    outcome: 'complete' | 'fail',
    expectedState: string,
  ): Promise<void> {
    const worker = new Worker<NotificationEmailJobData>(
      NOTIFICATION_EMAIL_QUEUE,
      async () => {
        if (outcome === 'fail') {
          throw new Error('integration provider failure');
        }
        return 'delivered';
      },
      { connection },
    );

    try {
      await worker.waitUntilReady();
      await waitForJobState(jobId, expectedState);
    } finally {
      await worker.close();
    }
  }

  function processor(provider: EmailProvider): NotificationEmailProcessor {
    return new NotificationEmailProcessor(provider);
  }

  function jobFor(notificationId: string): Job<NotificationEmailJobData> {
    return {
      id: notificationId,
      data: { notificationId },
    } as unknown as Job<NotificationEmailJobData>;
  }

  beforeAll(async () => {
    process.env.EMAIL_PROVIDER = 'log';
    process.env.EMAIL_MAX_ATTEMPTS = '5';
    process.env.EMAIL_RECONCILE_ENABLED = 'true';
    process.env.EMAIL_RECONCILE_BATCH_SIZE = '200';
    process.env.EMAIL_RECONCILE_STALE_MINUTES = '1';
    delete process.env.POSTMARK_SERVER_TOKEN;

    const active = await prisma.user.create({
      data: {
        email: activeEmail,
        passwordHash: 'not-a-real-hash',
        displayName: 'M3 active recipient',
      },
    });
    const inactive = await prisma.user.create({
      data: {
        email: inactiveEmail,
        passwordHash: 'not-a-real-hash',
        displayName: 'M3 inactive recipient',
        isActive: false,
      },
    });
    activeUserId = active.id;
    inactiveUserId = inactive.id;

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
        BullModule.forRootAsync({
          inject: [ConfigService],
          useFactory: createBullConnectionOptions,
        }),
        BullModule.registerQueue({
          name: NOTIFICATION_EMAIL_QUEUE,
          defaultJobOptions: {
            attempts: 5,
            backoff: { type: 'exponential', delay: 30_000 },
            removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
            removeOnFail: { age: 7 * 24 * 60 * 60, count: 5000 },
          },
        }),
      ],
      providers: [EmailDispatchService, NotificationEmailReconciler],
    }).compile();

    queue = moduleRef.get<Queue<NotificationEmailJobData>>(getQueueToken(NOTIFICATION_EMAIL_QUEUE));
    dispatch = moduleRef.get(EmailDispatchService);
    reconciler = moduleRef.get(NotificationEmailReconciler);

    const config = moduleRef.get(ConfigService);
    const password = config.get<string>('redis.password');
    connection = {
      host: config.get<string>('redis.host', 'localhost'),
      port: config.get<number>('redis.port', 6379),
      ...(password ? { password } : {}),
    };

    await queue.waitUntilReady();
  });

  beforeEach(async () => {
    await queue.obliterate({ force: true });
    await prisma.notification.deleteMany({
      where: { recipientId: { in: [activeUserId, inactiveUserId] } },
    });
  });

  afterAll(async () => {
    try {
      await queue.obliterate({ force: true });
    } finally {
      await moduleRef?.close();
      await prisma.notification.deleteMany({
        where: { recipientId: { in: [activeUserId, inactiveUserId] } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: [activeUserId, inactiveUserId] } },
      });
    }
  });

  describe('EmailDispatchService (real queue + database)', () => {
    it('enqueues an eligible PENDING notification with jobId = notification.id', async () => {
      const id = await createNotification();

      await dispatch.dispatchEmailsSafely([id, id]);

      const job = await queue.getJob(id);
      expect(job).not.toBeNull();
      expect(job!.name).toBe(NOTIFICATION_EMAIL_JOB);
      expect(job!.data).toEqual({ notificationId: id });
      expect(await job!.getState()).toBe('waiting');

      const stored = await prisma.notification.findUnique({ where: { id } });
      expect(stored!.emailStatus).toBe('PENDING');
    });

    it('conditionally skips an inactive recipient without enqueueing', async () => {
      const id = await createNotification({ recipientId: inactiveUserId });

      await dispatch.dispatchEmailsSafely([id]);

      const stored = await prisma.notification.findUnique({ where: { id } });
      expect(stored!.emailStatus).toBe('SKIPPED');
      expect(await queue.getJob(id)).toBeFalsy();
    });

    it('leaves PENDING on an enqueue failure and the reconciler repairs it', async () => {
      const id = await createNotification();
      const addSpy = jest
        .spyOn(queue, 'add')
        .mockRejectedValueOnce(new Error('Redis connection refused'));

      await expect(dispatch.dispatchEmailsSafely([id])).resolves.toBeUndefined();
      addSpy.mockRestore();

      expect((await prisma.notification.findUnique({ where: { id } }))!.emailStatus).toBe(
        'PENDING',
      );
      expect(await queue.getJob(id)).toBeFalsy();

      await reconciler.reconcile();

      const repaired = await queue.getJob(id);
      expect(repaired).not.toBeNull();
      expect(repaired!.data).toEqual({ notificationId: id });
      expect((await prisma.notification.findUnique({ where: { id } }))!.emailStatus).toBe(
        'PENDING',
      );
    });

    it('recovers a crash-before-enqueue notification with an inactive recipient as SKIPPED', async () => {
      const id = await createNotification({ recipientId: inactiveUserId });

      await reconciler.reconcile();

      const stored = await prisma.notification.findUnique({ where: { id } });
      expect(stored!.emailStatus).toBe('SKIPPED');
      expect(stored!.emailAttempts).toBe(0);
      expect(await queue.getJob(id)).toBeFalsy();
    });
  });

  describe('NotificationEmailProcessor (real database, fake provider)', () => {
    it('sends once, marks SENT conditionally, and is a no-op on redelivery', async () => {
      const id = await createNotification();
      const fake = fakeProvider();
      const workerProcessor = processor(fake.provider);

      await workerProcessor.process(jobFor(id));

      expect(fake.send).toHaveBeenCalledTimes(1);
      expect(fake.send).toHaveBeenCalledWith({
        to: activeEmail,
        subject: '[DailyStar] M3 email integration',
        text: 'Your article was approved.',
        notificationId: id,
      });

      const sent = await prisma.notification.findUnique({ where: { id } });
      expect(sent!.emailStatus).toBe('SENT');
      expect(sent!.emailAttempts).toBe(1);
      expect(sent!.emailSentAt).toBeInstanceOf(Date);

      await workerProcessor.process(jobFor(id));

      expect(fake.send).toHaveBeenCalledTimes(1);
      const unchanged = await prisma.notification.findUnique({ where: { id } });
      expect(unchanged!.emailStatus).toBe('SENT');
      expect(unchanged!.emailAttempts).toBe(1);
      expect(unchanged!.emailSentAt!.toISOString()).toBe(sent!.emailSentAt!.toISOString());
    });

    it('marks an inactive recipient SKIPPED without calling the provider', async () => {
      const id = await createNotification({ recipientId: inactiveUserId });
      const fake = fakeProvider();

      await processor(fake.provider).process(jobFor(id));

      expect(fake.send).not.toHaveBeenCalled();
      const stored = await prisma.notification.findUnique({ where: { id } });
      expect(stored!.emailStatus).toBe('SKIPPED');
      expect(stored!.emailAttempts).toBe(0);
    });

    it('records a failed attempt conditionally, leaves PENDING, and rethrows for retry', async () => {
      const id = await createNotification();
      const fake = fakeProvider(async () => {
        throw new Error('Postmark email delivery failed with HTTP 503');
      });

      await expect(processor(fake.provider).process(jobFor(id))).rejects.toThrow('HTTP 503');

      const stored = await prisma.notification.findUnique({ where: { id } });
      expect(stored!.emailStatus).toBe('PENDING');
      expect(stored!.emailAttempts).toBe(1);
      expect(stored!.emailLastError).toBe('Postmark email delivery failed with HTTP 503');
      expect(stored!.emailSentAt).toBeNull();
    });

    it('never overwrites a terminal state written while the provider call was in flight', async () => {
      const id = await createNotification();
      const resolvedAt = new Date();
      const fake = fakeProvider(async () => {
        await prisma.notification.update({
          where: { id },
          data: {
            emailStatus: 'FAILED',
            emailLastError: 'reconciler resolved during send',
            emailSentAt: resolvedAt,
          },
        });
      });

      await processor(fake.provider).process(jobFor(id));

      const stored = await prisma.notification.findUnique({ where: { id } });
      expect(stored!.emailStatus).toBe('FAILED');
      expect(stored!.emailLastError).toBe('reconciler resolved during send');
      expect(stored!.emailAttempts).toBe(0);
      expect(stored!.emailSentAt!.toISOString()).toBe(resolvedAt.toISOString());
    });

    it('allows concurrent processors but only one conditional terminal write', async () => {
      const id = await createNotification();
      let started = 0;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const fake = fakeProvider(async () => {
        started += 1;
        if (started === 2) {
          release();
        }
        await Promise.race([gate, delay(500)]);
      });

      const first = processor(fake.provider);
      const second = processor(fake.provider);
      await Promise.all([first.process(jobFor(id)), second.process(jobFor(id))]);

      expect(started).toBeGreaterThanOrEqual(1);
      expect(started).toBeLessThanOrEqual(2);

      const stored = await prisma.notification.findUnique({ where: { id } });
      expect(stored!.emailStatus).toBe('SENT');
      expect(stored!.emailAttempts).toBe(1);
      expect(stored!.emailSentAt).toBeInstanceOf(Date);
    });
  });

  describe('NotificationEmailReconciler (real queue + database)', () => {
    it('converts PENDING to SENT from completed job evidence and never resends', async () => {
      const id = await createNotification();
      await addJob(id, { attempts: 1 });
      await processWithWorker(id, 'complete', 'completed');

      await reconciler.reconcile();

      const sent = await prisma.notification.findUnique({ where: { id } });
      expect(sent!.emailStatus).toBe('SENT');
      expect(sent!.emailSentAt).toBeInstanceOf(Date);
      expect(sent!.emailAttempts).toBe(0);

      const sentAt = sent!.emailSentAt!.toISOString();
      await reconciler.reconcile();

      const unchanged = await prisma.notification.findUnique({ where: { id } });
      expect(unchanged!.emailStatus).toBe('SENT');
      expect(unchanged!.emailSentAt!.toISOString()).toBe(sentAt);
      expect(await queue.getJob(id)).not.toBeNull();
    });

    it('leaves a live waiting job and its PENDING row untouched', async () => {
      const id = await createNotification();
      await addJob(id);

      await reconciler.reconcile();

      const stored = await prisma.notification.findUnique({ where: { id } });
      expect(stored!.emailStatus).toBe('PENDING');
      expect(stored!.emailAttempts).toBe(0);

      const job = await queue.getJob(id);
      expect(job).not.toBeNull();
      expect(await job!.getState()).toBe('waiting');
      expect(job!.attemptsMade).toBe(0);
    });

    it('leaves a failed job with retries remaining (delayed) untouched', async () => {
      const id = await createNotification();
      await addJob(id, { attempts: 3, backoffDelay: 60_000 });
      await processWithWorker(id, 'fail', 'delayed');

      await reconciler.reconcile();

      const stored = await prisma.notification.findUnique({ where: { id } });
      expect(stored!.emailStatus).toBe('PENDING');
      expect(stored!.emailAttempts).toBe(0);
      expect(stored!.emailLastError).toBeNull();

      const job = await queue.getJob(id);
      expect(job).not.toBeNull();
      expect(await job!.getState()).toBe('delayed');
      expect(job!.attemptsMade).toBe(1);
    });

    it('marks an exhausted eligible delivery FAILED with the job failure reason', async () => {
      const id = await createNotification();
      await addJob(id, { attempts: 1 });
      await processWithWorker(id, 'fail', 'failed');

      await reconciler.reconcile();

      const stored = await prisma.notification.findUnique({ where: { id } });
      expect(stored!.emailStatus).toBe('FAILED');
      expect(stored!.emailLastError).toContain('integration provider failure');
      expect(stored!.emailAttempts).toBe(0);
      expect(await queue.getJob(id)).not.toBeNull();
    });

    it('marks an exhausted ineligible delivery SKIPPED', async () => {
      const id = await createNotification({ recipientId: inactiveUserId });
      await addJob(id, { attempts: 1 });
      await processWithWorker(id, 'fail', 'failed');

      await reconciler.reconcile();

      const stored = await prisma.notification.findUnique({ where: { id } });
      expect(stored!.emailStatus).toBe('SKIPPED');
    });

    it('re-enqueues a missing job for an eligible recipient with attempts remaining', async () => {
      const id = await createNotification({ emailAttempts: 2 });

      await reconciler.reconcile();

      const job = await queue.getJob(id);
      expect(job).not.toBeNull();
      expect(job!.name).toBe(NOTIFICATION_EMAIL_JOB);
      expect(job!.data).toEqual({ notificationId: id });
      expect(job!.opts.attempts).toBe(5);
      expect(await job!.getState()).toBe('waiting');

      const stored = await prisma.notification.findUnique({ where: { id } });
      expect(stored!.emailStatus).toBe('PENDING');
      expect(stored!.emailAttempts).toBe(2);
    });

    it('marks a missing job FAILED when an eligible recipient exhausted attempts', async () => {
      const id = await createNotification({
        emailAttempts: 5,
        emailLastError: 'previous provider failure',
      });

      await reconciler.reconcile();

      const stored = await prisma.notification.findUnique({ where: { id } });
      expect(stored!.emailStatus).toBe('FAILED');
      expect(stored!.emailLastError).toBe('previous provider failure');
      expect(await queue.getJob(id)).toBeFalsy();
    });

    it('marks a missing job SKIPPED for an ineligible recipient with attempts remaining', async () => {
      const id = await createNotification({
        recipientId: inactiveUserId,
        emailAttempts: 1,
      });

      await reconciler.reconcile();

      const stored = await prisma.notification.findUnique({ where: { id } });
      expect(stored!.emailStatus).toBe('SKIPPED');
      expect(await queue.getJob(id)).toBeFalsy();
    });

    it('leaves rows PENDING without incrementing attempts when Redis is unavailable', async () => {
      const id = await createNotification({ emailAttempts: 2 });
      const getJobSpy = jest
        .spyOn(queue, 'getJob')
        .mockRejectedValueOnce(new Error('Redis connection refused'));

      await expect(reconciler.reconcile()).resolves.toBeUndefined();
      getJobSpy.mockRestore();

      const stored = await prisma.notification.findUnique({ where: { id } });
      expect(stored!.emailStatus).toBe('PENDING');
      expect(stored!.emailAttempts).toBe(2);
      expect(await queue.getJob(id)).toBeFalsy();

      // A later sweep with Redis restored must repair the row.
      await reconciler.reconcile();
      expect(await queue.getJob(id)).not.toBeNull();
    });

    it('does not overwrite an already-SENT row from a retained completed job', async () => {
      const id = await createNotification();
      const sentAt = new Date('2026-10-01T00:00:00.000Z');
      await prisma.notification.update({
        where: { id },
        data: { emailStatus: 'SENT', emailSentAt: sentAt, emailAttempts: 1 },
      });
      await addJob(id, { attempts: 1 });
      await processWithWorker(id, 'complete', 'completed');

      await reconciler.reconcile();

      const stored = await prisma.notification.findUnique({ where: { id } });
      expect(stored!.emailStatus).toBe('SENT');
      expect(stored!.emailSentAt!.toISOString()).toBe(sentAt.toISOString());
      expect(stored!.emailAttempts).toBe(1);
    });

    it('does not overwrite a terminal SKIPPED row from a retained failed job', async () => {
      const id = await createNotification();
      await prisma.notification.update({
        where: { id },
        data: { emailStatus: 'SKIPPED' },
      });
      await addJob(id, { attempts: 1 });
      await processWithWorker(id, 'fail', 'failed');

      await reconciler.reconcile();

      const stored = await prisma.notification.findUnique({ where: { id } });
      expect(stored!.emailStatus).toBe('SKIPPED');
      expect(stored!.emailLastError).toBeNull();
    });

    it('leaves an active in-flight send PENDING and untouched, then records SENT after release', async () => {
      const id = await createNotification();
      await addJob(id, { attempts: 1 });

      let releaseSend!: () => void;
      const sendGate = new Promise<void>((resolve) => {
        releaseSend = resolve;
      });
      let notifyStarted!: () => void;
      const sendStarted = new Promise<void>((resolve) => {
        notifyStarted = resolve;
      });
      const fake = fakeProvider(async () => {
        notifyStarted();
        await sendGate;
      });

      const workerProcessor = processor(fake.provider);
      const worker = new Worker<NotificationEmailJobData>(
        NOTIFICATION_EMAIL_QUEUE,
        async (job) => workerProcessor.process(job),
        { connection },
      );

      try {
        await worker.waitUntilReady();
        await sendStarted;

        const activeJob = await queue.getJob(id);
        expect(activeJob).toBeTruthy();
        expect(await activeJob!.getState()).toBe('active');

        // The provider call is already in flight; the recipient becomes
        // ineligible while the job is observed active by the sweep.
        await prisma.user.update({
          where: { id: activeUserId },
          data: { isActive: false },
        });

        await reconciler.reconcile();

        const pending = await prisma.notification.findUnique({ where: { id } });
        expect(pending!.emailStatus).toBe('PENDING');
        expect(pending!.emailAttempts).toBe(0);

        const untouchedJob = await queue.getJob(id);
        expect(untouchedJob).toBeTruthy();
        expect(await untouchedJob!.getState()).toBe('active');
        expect(untouchedJob!.attemptsMade).toBe(0);

        releaseSend();
        await waitForJobState(id, 'completed');

        const sent = await prisma.notification.findUnique({ where: { id } });
        expect(sent!.emailStatus).toBe('SENT');
        expect(sent!.emailSentAt).toBeInstanceOf(Date);
        expect(fake.send).toHaveBeenCalledTimes(1);
      } finally {
        releaseSend();
        await worker.close();
        await prisma.user.update({
          where: { id: activeUserId },
          data: { isActive: true },
        });
      }
    });
  });
});
