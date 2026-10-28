jest.mock('../../../database/client', () => ({
  prisma: {
    notification: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

import { Queue } from 'bullmq';
import { prisma } from '../../../database/client';
import { EmailDispatchService } from './email-dispatch.service';
import { NOTIFICATION_EMAIL_JOB, NotificationEmailJobData } from './email.constants';

const notificationDelegate = prisma.notification as unknown as {
  findMany: jest.Mock;
  updateMany: jest.Mock;
};

function buildQueue() {
  return { add: jest.fn().mockResolvedValue(undefined) };
}

function pendingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'notification-1',
    type: 'ARTICLE_APPROVED',
    recipientId: 'user-1',
    recipient: { email: 'author@dailystar.local', isActive: true },
    ...overrides,
  };
}

describe('EmailDispatchService', () => {
  let service: EmailDispatchService;
  let queue: ReturnType<typeof buildQueue>;

  beforeEach(() => {
    queue = buildQueue();
    // The injected queue token is an implementation detail of @nestjs/bullmq
    // and is irrelevant to this unit under test.
    service = new EmailDispatchService(queue as unknown as Queue<NotificationEmailJobData>);
    jest.clearAllMocks();
  });

  it('returns immediately for an empty list', async () => {
    await service.dispatchEmailsSafely([]);

    expect(notificationDelegate.findMany).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('loads only PENDING notifications and deduplicates ids', async () => {
    notificationDelegate.findMany.mockResolvedValue([pendingRow()]);

    await service.dispatchEmailsSafely(['notification-1', 'notification-1']);

    expect(notificationDelegate.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['notification-1'] }, emailStatus: 'PENDING' },
      select: {
        id: true,
        type: true,
        recipientId: true,
        recipient: { select: { email: true, isActive: true } },
      },
    });
  });

  it('enqueues an eligible notification with jobId = notification.id', async () => {
    notificationDelegate.findMany.mockResolvedValue([pendingRow()]);

    await service.dispatchEmailsSafely(['notification-1']);

    expect(queue.add).toHaveBeenCalledWith(
      NOTIFICATION_EMAIL_JOB,
      { notificationId: 'notification-1' },
      { jobId: 'notification-1' },
    );
    expect(notificationDelegate.updateMany).not.toHaveBeenCalled();
  });

  it('conditionally skips an inactive recipient without enqueueing', async () => {
    notificationDelegate.findMany.mockResolvedValue([
      pendingRow({ recipient: { email: 'author@dailystar.local', isActive: false } }),
    ]);
    notificationDelegate.updateMany.mockResolvedValue({ count: 1 });

    await service.dispatchEmailsSafely(['notification-1']);

    expect(notificationDelegate.updateMany).toHaveBeenCalledWith({
      where: { id: 'notification-1', emailStatus: 'PENDING' },
      data: { emailStatus: 'SKIPPED' },
    });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('conditionally skips a recipient without an email address', async () => {
    notificationDelegate.findMany.mockResolvedValue([
      pendingRow({ recipient: { email: '', isActive: true } }),
    ]);
    notificationDelegate.updateMany.mockResolvedValue({ count: 1 });

    await service.dispatchEmailsSafely(['notification-1']);

    expect(notificationDelegate.updateMany).toHaveBeenCalledWith({
      where: { id: 'notification-1', emailStatus: 'PENDING' },
      data: { emailStatus: 'SKIPPED' },
    });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('catches enqueue failures and leaves the row PENDING', async () => {
    notificationDelegate.findMany.mockResolvedValue([pendingRow()]);
    queue.add.mockRejectedValue(new Error('Redis connection refused'));

    await expect(service.dispatchEmailsSafely(['notification-1'])).resolves.toBeUndefined();

    expect(notificationDelegate.updateMany).not.toHaveBeenCalled();
  });

  it('catches database failures without throwing', async () => {
    notificationDelegate.findMany.mockRejectedValue(new Error('database unavailable'));

    await expect(service.dispatchEmailsSafely(['notification-1'])).resolves.toBeUndefined();
    expect(queue.add).not.toHaveBeenCalled();
  });
});
