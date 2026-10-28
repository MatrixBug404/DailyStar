import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

jest.mock('../../database/client', () => ({
  prisma: {
    notification: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

import { prisma } from '../../database/client';
import { NotificationType } from '@dailystar/types';
import { NotificationsService } from './notifications.service';
import { RecipientResolverService } from './recipient-resolver.service';

const notificationDelegate = prisma.notification as unknown as {
  findMany: jest.Mock;
  count: jest.Mock;
  findUnique: jest.Mock;
  update: jest.Mock;
  updateMany: jest.Mock;
};

const transactionMock = prisma.$transaction as unknown as jest.Mock;

function buildRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'notification-1',
    recipientId: 'user-1',
    type: NotificationType.ARTICLE_APPROVED,
    title: 'Article approved',
    body: 'Your article was approved.',
    articleId: 'article-1',
    dedupeKey: 'article-approved:article-1:2',
    data: { articleVersion: 2 },
    readAt: null,
    emailStatus: 'PENDING',
    emailAttempts: 0,
    emailLastError: null,
    emailSentAt: null,
    createdAt: new Date('2026-10-20T10:00:00.000Z'),
    updatedAt: new Date('2026-10-20T10:00:00.000Z'),
    ...overrides,
  };
}

describe('NotificationsService', () => {
  let service: NotificationsService;
  let recipientResolver: {
    resolveRecipientsForEvent: jest.Mock;
  };

  beforeEach(async () => {
    recipientResolver = {
      resolveRecipientsForEvent: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: RecipientResolverService, useValue: recipientResolver },
      ],
    }).compile();

    service = module.get(NotificationsService);
    jest.clearAllMocks();
    recipientResolver.resolveRecipientsForEvent.mockResolvedValue([]);
    transactionMock.mockImplementation((operations: Promise<unknown>[]) => Promise.all(operations));
  });

  describe('createForEventSafely', () => {
    function eventInput(overrides: Record<string, unknown> = {}) {
      return {
        type: NotificationType.ARTICLE_APPROVED,
        articleId: 'article-1',
        primaryAuthorId: 'author-1',
        actorId: 'editor-1',
        dedupeKey: 'article-approved:article-1:3',
        title: 'Article approved',
        body: '“Article title” was approved by Editor One.',
        data: { articleVersion: 3 },
        ...overrides,
      };
    }

    function txMock() {
      return {
        user: { findMany: jest.fn(), findUnique: jest.fn() },
        notification: {
          createManyAndReturn: jest.fn().mockResolvedValue([{ id: 'notification-1' }]),
        },
        $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      };
    }

    it('does not open a savepoint or write when there are no eligible recipients', async () => {
      const tx = txMock();
      recipientResolver.resolveRecipientsForEvent.mockResolvedValue([]);

      const created = await service.createForEventSafely(tx as any, eventInput());

      expect(created).toEqual([]);
      expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
      expect(tx.notification.createManyAndReturn).not.toHaveBeenCalled();
    });

    it('resolves recipients through the transaction client and inserts with the event snapshot', async () => {
      const tx = txMock();
      recipientResolver.resolveRecipientsForEvent.mockResolvedValue([
        { id: 'author-1', email: 'author@dailystar.local' },
      ]);

      const created = await service.createForEventSafely(tx as any, eventInput());

      expect(recipientResolver.resolveRecipientsForEvent).toHaveBeenCalledWith(
        NotificationType.ARTICLE_APPROVED,
        { id: 'article-1', primaryAuthorId: 'author-1' },
        'editor-1',
        tx,
      );
      expect(tx.$executeRawUnsafe.mock.calls.map((call) => call[0])).toEqual([
        'SAVEPOINT notification_create',
        'RELEASE SAVEPOINT notification_create',
      ]);
      expect(tx.notification.createManyAndReturn).toHaveBeenCalledWith({
        data: [
          {
            recipientId: 'author-1',
            type: NotificationType.ARTICLE_APPROVED,
            title: 'Article approved',
            body: '“Article title” was approved by Editor One.',
            articleId: 'article-1',
            dedupeKey: 'article-approved:article-1:3',
            data: { articleVersion: 3 },
          },
        ],
        skipDuplicates: true,
        select: { id: true },
      });
      expect(created).toEqual([{ id: 'notification-1' }]);
    });

    it('rolls back to the savepoint and preserves the enclosing transaction on insert failure', async () => {
      const tx = txMock();
      recipientResolver.resolveRecipientsForEvent.mockResolvedValue([
        { id: 'author-1', email: 'author@dailystar.local' },
      ]);
      tx.notification.createManyAndReturn.mockRejectedValue(
        Object.assign(new Error('value too long for type character varying(200)'), {
          code: 'P2000',
        }),
      );

      const created = await service.createForEventSafely(tx as any, eventInput());

      expect(created).toEqual([]);
      expect(tx.$executeRawUnsafe.mock.calls.map((call) => call[0])).toEqual([
        'SAVEPOINT notification_create',
        'ROLLBACK TO SAVEPOINT notification_create',
        'RELEASE SAVEPOINT notification_create',
      ]);
    });

    it('uses the unique constraint for duplicate suppression (skipDuplicates)', async () => {
      const tx = txMock();
      recipientResolver.resolveRecipientsForEvent.mockResolvedValue([
        { id: 'author-1', email: 'author@dailystar.local' },
      ]);
      tx.notification.createManyAndReturn.mockResolvedValue([]);

      const created = await service.createForEventSafely(tx as any, eventInput());

      expect(created).toEqual([]);
      expect(tx.notification.createManyAndReturn).toHaveBeenCalledWith(
        expect.objectContaining({ skipDuplicates: true }),
      );
    });

    it('omits the optional data column when the event carries none', async () => {
      const tx = txMock();
      recipientResolver.resolveRecipientsForEvent.mockResolvedValue([
        { id: 'author-1', email: 'author@dailystar.local' },
      ]);

      await service.createForEventSafely(tx as any, eventInput({ data: undefined }));

      const payload = tx.notification.createManyAndReturn.mock.calls[0][0].data[0];
      expect(payload).not.toHaveProperty('data');
    });
  });

  describe('list', () => {
    it('scopes the query to the authenticated user and returns the pagination envelope', async () => {
      const rows = [buildRow()];
      notificationDelegate.findMany.mockResolvedValue(rows);
      notificationDelegate.count.mockResolvedValue(1);

      const result = await service.list('user-1', { page: 1, limit: 20 });

      expect(notificationDelegate.findMany).toHaveBeenCalledWith({
        where: { recipientId: 'user-1' },
        skip: 0,
        take: 20,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      });
      expect(notificationDelegate.count).toHaveBeenCalledWith({
        where: { recipientId: 'user-1' },
      });
      expect(result).toEqual({
        data: [
          {
            id: 'notification-1',
            type: NotificationType.ARTICLE_APPROVED,
            title: 'Article approved',
            body: 'Your article was approved.',
            articleId: 'article-1',
            readAt: null,
            createdAt: '2026-10-20T10:00:00.000Z',
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
      });
    });

    it('strips internal fields from the response', async () => {
      notificationDelegate.findMany.mockResolvedValue([buildRow()]);
      notificationDelegate.count.mockResolvedValue(1);

      const result = await service.list('user-1', { page: 1, limit: 20 });
      const item = result.data[0] as unknown as Record<string, unknown>;

      expect(item).not.toHaveProperty('dedupeKey');
      expect(item).not.toHaveProperty('emailStatus');
      expect(item).not.toHaveProperty('emailAttempts');
      expect(item).not.toHaveProperty('emailLastError');
      expect(item).not.toHaveProperty('data');
      expect(item).not.toHaveProperty('recipientId');
    });

    it('filters to unread only when unreadOnly is true', async () => {
      notificationDelegate.findMany.mockResolvedValue([]);
      notificationDelegate.count.mockResolvedValue(0);

      await service.list('user-42', { page: 2, limit: 5, unreadOnly: true });

      expect(notificationDelegate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { recipientId: 'user-42', readAt: null },
          skip: 5,
          take: 5,
        }),
      );
      expect(notificationDelegate.count).toHaveBeenCalledWith({
        where: { recipientId: 'user-42', readAt: null },
      });
    });

    it('does not filter read-state when unreadOnly is false or omitted', async () => {
      notificationDelegate.findMany.mockResolvedValue([]);
      notificationDelegate.count.mockResolvedValue(0);

      await service.list('user-42', { page: 1, limit: 20, unreadOnly: false });

      const findManyArgs = notificationDelegate.findMany.mock.calls[0][0];
      expect(findManyArgs.where).toEqual({ recipientId: 'user-42' });
    });

    it('serializes readAt as an ISO string once read', async () => {
      notificationDelegate.findMany.mockResolvedValue([
        buildRow({ readAt: new Date('2026-10-21T08:30:00.000Z') }),
      ]);
      notificationDelegate.count.mockResolvedValue(1);

      const result = await service.list('user-1', { page: 1, limit: 20 });

      expect(result.data[0].readAt).toBe('2026-10-21T08:30:00.000Z');
    });
  });

  describe('unreadCount', () => {
    it('counts only the caller unread notifications', async () => {
      notificationDelegate.count.mockResolvedValue(3);

      const result = await service.unreadCount('user-1');

      expect(notificationDelegate.count).toHaveBeenCalledWith({
        where: { recipientId: 'user-1', readAt: null },
      });
      expect(result).toEqual({ unread: 3 });
    });
  });

  describe('markRead', () => {
    it('throws 404 for a notification owned by another user and never updates it', async () => {
      notificationDelegate.findUnique.mockResolvedValue(buildRow({ recipientId: 'someone-else' }));

      await expect(service.markRead('user-1', 'notification-1')).rejects.toThrow(NotFoundException);
      expect(notificationDelegate.update).not.toHaveBeenCalled();
    });

    it('throws 404 for a missing notification', async () => {
      notificationDelegate.findUnique.mockResolvedValue(null);

      await expect(service.markRead('user-1', 'missing')).rejects.toThrow(NotFoundException);
      expect(notificationDelegate.update).not.toHaveBeenCalled();
    });

    it('marks an unread notification as read', async () => {
      const readAt = new Date('2026-10-22T12:00:00.000Z');
      notificationDelegate.findUnique.mockResolvedValue(buildRow());
      notificationDelegate.update.mockResolvedValue(buildRow({ readAt }));

      const result = await service.markRead('user-1', 'notification-1');

      expect(notificationDelegate.update).toHaveBeenCalledWith({
        where: { id: 'notification-1' },
        data: { readAt: expect.any(Date) },
      });
      expect(result.readAt).toBe(readAt.toISOString());
    });

    it('is idempotent: an already-read notification is returned without a write', async () => {
      const readAt = new Date('2026-10-21T08:30:00.000Z');
      notificationDelegate.findUnique.mockResolvedValue(buildRow({ readAt }));

      const result = await service.markRead('user-1', 'notification-1');

      expect(notificationDelegate.update).not.toHaveBeenCalled();
      expect(result.readAt).toBe('2026-10-21T08:30:00.000Z');
    });
  });

  describe('markAllRead', () => {
    it('updates only the caller unread rows and returns the count', async () => {
      notificationDelegate.updateMany.mockResolvedValue({ count: 4 });

      const result = await service.markAllRead('user-1');

      expect(notificationDelegate.updateMany).toHaveBeenCalledWith({
        where: { recipientId: 'user-1', readAt: null },
        data: { readAt: expect.any(Date) },
      });
      expect(result).toEqual({ updated: 4 });
    });
  });
});
