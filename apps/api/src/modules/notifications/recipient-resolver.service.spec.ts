import { Test, TestingModule } from '@nestjs/testing';

jest.mock('../../database/client', () => ({
  prisma: {
    user: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
  },
}));

import { prisma } from '../../database/client';
import { NotificationType } from '@dailystar/types';
import {
  EDITOR_NOTIFICATION_PERMISSION,
  RecipientResolverService,
} from './recipient-resolver.service';

const userDelegate = prisma.user as unknown as {
  findMany: jest.Mock;
  findUnique: jest.Mock;
};

describe('RecipientResolverService', () => {
  let resolver: RecipientResolverService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RecipientResolverService],
    }).compile();

    resolver = module.get(RecipientResolverService);
    jest.clearAllMocks();
  });

  describe('resolveEditorRecipients', () => {
    it('selects editors by the article.start-review permission, active only, excluding the actor', async () => {
      userDelegate.findMany.mockResolvedValue([
        { id: 'editor-1', email: 'editor1@dailystar.local', isActive: true },
        { id: 'editor-2', email: 'editor2@dailystar.local', isActive: true },
      ]);

      const recipients = await resolver.resolveEditorRecipients('actor-1');

      expect(userDelegate.findMany).toHaveBeenCalledWith({
        where: {
          isActive: true,
          id: { not: 'actor-1' },
          roles: {
            some: {
              role: {
                permissions: {
                  some: {
                    permission: { name: EDITOR_NOTIFICATION_PERMISSION },
                  },
                },
              },
            },
          },
        },
        select: { id: true, email: true, isActive: true },
        orderBy: { id: 'asc' },
      });
      expect(recipients).toEqual([
        { id: 'editor-1', email: 'editor1@dailystar.local' },
        { id: 'editor-2', email: 'editor2@dailystar.local' },
      ]);
    });

    it('defensively drops inactive rows even if the query returns one', async () => {
      userDelegate.findMany.mockResolvedValue([
        { id: 'editor-1', email: 'editor1@dailystar.local', isActive: true },
        { id: 'inactive-editor', email: 'inactive@dailystar.local', isActive: false },
      ]);

      const recipients = await resolver.resolveEditorRecipients('actor-1');

      expect(recipients.map((recipient) => recipient.id)).toEqual(['editor-1']);
    });

    it('does not exclude anyone for a scheduler-originated event (no human actor)', async () => {
      userDelegate.findMany.mockResolvedValue([
        { id: 'editor-1', email: 'editor1@dailystar.local', isActive: true },
      ]);

      await resolver.resolveEditorRecipients(null);

      const where = userDelegate.findMany.mock.calls[0][0].where;
      expect(where).not.toHaveProperty('id');
      expect(where.isActive).toBe(true);
    });

    it('returns an empty list when no active editor holds the permission', async () => {
      userDelegate.findMany.mockResolvedValue([]);

      await expect(resolver.resolveEditorRecipients('actor-1')).resolves.toEqual([]);
    });
  });

  describe('resolveAuthorRecipient', () => {
    it('targets Article.primaryAuthorId when the author is active', async () => {
      userDelegate.findUnique.mockResolvedValue({
        id: 'author-1',
        email: 'author@dailystar.local',
        isActive: true,
      });

      const recipients = await resolver.resolveAuthorRecipient('author-1', 'editor-1');

      expect(userDelegate.findUnique).toHaveBeenCalledWith({
        where: { id: 'author-1' },
        select: { id: true, email: true, isActive: true },
      });
      expect(recipients).toEqual([{ id: 'author-1', email: 'author@dailystar.local' }]);
    });

    it('returns no notification target for an inactive author', async () => {
      userDelegate.findUnique.mockResolvedValue({
        id: 'author-1',
        email: 'author@dailystar.local',
        isActive: false,
      });

      await expect(resolver.resolveAuthorRecipient('author-1', 'editor-1')).resolves.toEqual([]);
    });

    it('returns no notification target for a missing author', async () => {
      userDelegate.findUnique.mockResolvedValue(null);

      await expect(resolver.resolveAuthorRecipient('missing-author', 'editor-1')).resolves.toEqual(
        [],
      );
    });

    it('excludes the acting user', async () => {
      userDelegate.findUnique.mockResolvedValue({
        id: 'author-1',
        email: 'author@dailystar.local',
        isActive: true,
      });

      await expect(resolver.resolveAuthorRecipient('author-1', 'author-1')).resolves.toEqual([]);
    });

    it('returns an empty list without querying when the article has no author id', async () => {
      await expect(resolver.resolveAuthorRecipient(null, 'editor-1')).resolves.toEqual([]);
      expect(userDelegate.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('resolveRecipientsForEvent', () => {
    it('resolves editors for ARTICLE_SUBMITTED_FOR_REVIEW', async () => {
      userDelegate.findMany.mockResolvedValue([
        { id: 'editor-1', email: 'editor1@dailystar.local', isActive: true },
      ]);

      const recipients = await resolver.resolveRecipientsForEvent(
        NotificationType.ARTICLE_SUBMITTED_FOR_REVIEW,
        { id: 'article-1', primaryAuthorId: 'author-1' },
        'author-1',
      );

      expect(recipients).toEqual([{ id: 'editor-1', email: 'editor1@dailystar.local' }]);
      expect(userDelegate.findUnique).not.toHaveBeenCalled();
    });

    it('resolves editors for scheduler-originated ARTICLE_FAILED_TO_PUBLISH', async () => {
      userDelegate.findMany.mockResolvedValue([
        { id: 'editor-1', email: 'editor1@dailystar.local', isActive: true },
        { id: 'admin-1', email: 'admin@dailystar.local', isActive: true },
      ]);

      const recipients = await resolver.resolveRecipientsForEvent(
        NotificationType.ARTICLE_FAILED_TO_PUBLISH,
        { id: 'article-1', primaryAuthorId: 'author-1' },
        null,
      );

      expect(recipients.map((recipient) => recipient.id)).toEqual(['editor-1', 'admin-1']);
      expect(userDelegate.findMany.mock.calls[0][0].where).not.toHaveProperty('id');
    });

    it.each([NotificationType.ARTICLE_APPROVED, NotificationType.ARTICLE_REJECTED])(
      'resolves only the article author for %s',
      async (type) => {
        userDelegate.findUnique.mockResolvedValue({
          id: 'author-1',
          email: 'author@dailystar.local',
          isActive: true,
        });

        const recipients = await resolver.resolveRecipientsForEvent(
          type,
          { id: 'article-1', primaryAuthorId: 'author-1' },
          'editor-1',
        );

        expect(recipients).toEqual([{ id: 'author-1', email: 'author@dailystar.local' }]);
        expect(userDelegate.findMany).not.toHaveBeenCalled();
      },
    );

    it('returns no recipients when the author event has no eligible author', async () => {
      userDelegate.findUnique.mockResolvedValue({
        id: 'author-1',
        email: 'author@dailystar.local',
        isActive: false,
      });

      await expect(
        resolver.resolveRecipientsForEvent(
          NotificationType.ARTICLE_APPROVED,
          { id: 'article-1', primaryAuthorId: 'author-1' },
          'editor-1',
        ),
      ).resolves.toEqual([]);
    });
  });

  describe('mergeUniqueRecipients', () => {
    it('keeps a single row when a user qualifies through more than one path', () => {
      const merged = resolver.mergeUniqueRecipients([
        { id: 'user-1', email: 'user1@dailystar.local' },
        { id: 'user-2', email: 'user2@dailystar.local' },
        { id: 'user-1', email: 'user1@dailystar.local' },
      ]);

      expect(merged).toEqual([
        { id: 'user-1', email: 'user1@dailystar.local' },
        { id: 'user-2', email: 'user2@dailystar.local' },
      ]);
    });
  });

  describe('transaction client support', () => {
    it('reads through the supplied transaction client instead of the root client', async () => {
      const tx = {
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'author-1',
            email: 'author@dailystar.local',
            isActive: true,
          }),
        },
      };

      const recipients = await resolver.resolveAuthorRecipient('author-1', null, tx as any);

      expect(recipients).toEqual([{ id: 'author-1', email: 'author@dailystar.local' }]);
      expect(tx.user.findUnique).toHaveBeenCalled();
      expect(userDelegate.findUnique).not.toHaveBeenCalled();
    });
  });
});
