import { Job } from 'bullmq';
import { EmailProvider } from './email-provider.interface';
import { NotificationEmailProcessor } from './notification-email.processor';

jest.mock('../../../database/client', () => ({
  prisma: {
    notification: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

import { prisma } from '../../../database/client';

const notificationDelegate = prisma.notification as unknown as {
  findUnique: jest.Mock;
  updateMany: jest.Mock;
};

function notificationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'notification-1',
    type: 'ARTICLE_APPROVED',
    recipientId: 'user-1',
    title: 'Article approved',
    body: 'Your article was approved.',
    emailStatus: 'PENDING',
    emailAttempts: 0,
    emailLastError: null,
    recipient: { email: 'author@dailystar.local', isActive: true },
    ...overrides,
  };
}

function buildJob(notificationId = 'notification-1'): Job<{ notificationId: string }> {
  return { data: { notificationId } } as unknown as Job<{ notificationId: string }>;
}

describe('NotificationEmailProcessor', () => {
  let provider: { send: jest.Mock };
  let processor: NotificationEmailProcessor;

  beforeEach(() => {
    provider = { send: jest.fn().mockResolvedValue(undefined) };
    processor = new NotificationEmailProcessor(provider as unknown as EmailProvider);
    jest.clearAllMocks();
  });

  it('completes without side effects when the job has no notification id', async () => {
    await processor.process({ data: {} } as unknown as Job<{ notificationId: string }>);

    expect(notificationDelegate.findUnique).not.toHaveBeenCalled();
    expect(provider.send).not.toHaveBeenCalled();
  });

  it('completes without sending when the notification no longer exists', async () => {
    notificationDelegate.findUnique.mockResolvedValue(null);

    await processor.process(buildJob());

    expect(provider.send).not.toHaveBeenCalled();
    expect(notificationDelegate.updateMany).not.toHaveBeenCalled();
  });

  it.each(['SENT', 'SKIPPED', 'FAILED'])(
    'is a no-op for a terminal %s notification',
    async (emailStatus) => {
      notificationDelegate.findUnique.mockResolvedValue(notificationRow({ emailStatus }));

      await processor.process(buildJob());

      expect(provider.send).not.toHaveBeenCalled();
      expect(notificationDelegate.updateMany).not.toHaveBeenCalled();
    },
  );

  it('conditionally marks SKIPPED when the recipient is inactive, without sending', async () => {
    notificationDelegate.findUnique.mockResolvedValue(
      notificationRow({ recipient: { email: 'author@dailystar.local', isActive: false } }),
    );
    notificationDelegate.updateMany.mockResolvedValue({ count: 1 });

    await processor.process(buildJob());

    expect(provider.send).not.toHaveBeenCalled();
    expect(notificationDelegate.updateMany).toHaveBeenCalledWith({
      where: { id: 'notification-1', emailStatus: 'PENDING' },
      data: { emailStatus: 'SKIPPED' },
    });
  });

  it('conditionally marks SKIPPED when the recipient has no email, without sending', async () => {
    notificationDelegate.findUnique.mockResolvedValue(
      notificationRow({ recipient: { email: '', isActive: true } }),
    );
    notificationDelegate.updateMany.mockResolvedValue({ count: 1 });

    await processor.process(buildJob());

    expect(provider.send).not.toHaveBeenCalled();
    expect(notificationDelegate.updateMany).toHaveBeenCalledWith({
      where: { id: 'notification-1', emailStatus: 'PENDING' },
      data: { emailStatus: 'SKIPPED' },
    });
  });

  it('sends a prefixed plain-text email and conditionally marks SENT', async () => {
    notificationDelegate.findUnique.mockResolvedValue(notificationRow());
    notificationDelegate.updateMany.mockResolvedValue({ count: 1 });

    await processor.process(buildJob());

    expect(provider.send).toHaveBeenCalledWith({
      to: 'author@dailystar.local',
      subject: '[DailyStar] Article approved',
      text: 'Your article was approved.',
      notificationId: 'notification-1',
    });
    expect(notificationDelegate.updateMany).toHaveBeenCalledWith({
      where: { id: 'notification-1', emailStatus: 'PENDING' },
      data: {
        emailStatus: 'SENT',
        emailSentAt: expect.any(Date),
        emailAttempts: { increment: 1 },
      },
    });
  });

  it('does not overwrite a terminal state when the conditional SENT update matches zero rows', async () => {
    notificationDelegate.findUnique.mockResolvedValue(notificationRow());
    notificationDelegate.updateMany.mockResolvedValue({ count: 0 });

    await expect(processor.process(buildJob())).resolves.toBeUndefined();
    expect(provider.send).toHaveBeenCalledTimes(1);
  });

  it('records a failed attempt conditionally and rethrows for BullMQ retry', async () => {
    notificationDelegate.findUnique.mockResolvedValue(notificationRow());
    notificationDelegate.updateMany.mockResolvedValue({ count: 1 });
    provider.send.mockRejectedValue(new Error('Postmark email delivery failed with HTTP 503'));

    await expect(processor.process(buildJob())).rejects.toThrow('HTTP 503');

    expect(notificationDelegate.updateMany).toHaveBeenCalledWith({
      where: { id: 'notification-1', emailStatus: 'PENDING' },
      data: {
        emailAttempts: { increment: 1 },
        emailLastError: 'Postmark email delivery failed with HTTP 503',
      },
    });
  });

  it('completes without rethrowing when the failure update matches zero rows', async () => {
    notificationDelegate.findUnique.mockResolvedValue(notificationRow());
    notificationDelegate.updateMany.mockResolvedValue({ count: 0 });
    provider.send.mockRejectedValue(new Error('provider down'));

    await expect(processor.process(buildJob())).resolves.toBeUndefined();
  });
});
