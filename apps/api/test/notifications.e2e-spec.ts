import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { NotificationType } from '@dailystar/types';
import { AppModule } from './../src/app.module';
import { prisma } from '../src/database/client';
import { Prisma } from '../src/database/generated/prisma';
import { RecipientResolverService } from '../src/modules/notifications/recipient-resolver.service';

const TEST_EMAILS = {
  author: 'notifications_author_e2e@dailystar.local',
  editor: 'notifications_editor_e2e@dailystar.local',
  admin: 'notifications_admin_e2e@dailystar.local',
  inactiveEditor: 'notifications_inactive_editor_e2e@dailystar.local',
  inactiveAuthor: 'notifications_inactive_author_e2e@dailystar.local',
  outsider: 'notifications_outsider_e2e@dailystar.local',
  readUser: 'notifications_read_e2e@dailystar.local',
  readAllUser: 'notifications_read_all_e2e@dailystar.local',
};

const SLUG_PREFIX = 'phase8-notifications-e2e-';
const PASSWORD = 'password123';

const AUTHOR_NOTIFICATION_IDS = {
  oldestRead: '00000000-0000-4000-8000-000000000001',
  second: '00000000-0000-4000-8000-000000000002',
  third: '00000000-0000-4000-8000-000000000003',
  tieA: '00000000-0000-4000-8000-000000000004',
  tieB: '00000000-0000-4000-8000-000000000005',
};

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function notificationFixture(
  recipientId: string,
  overrides: Partial<Prisma.NotificationCreateManyInput> = {},
): Prisma.NotificationCreateManyInput {
  return {
    recipientId,
    type: 'ARTICLE_APPROVED',
    title: 'Fixture notification',
    body: 'Fixture body',
    dedupeKey: `e2e-notifications:${randomUUID()}`,
    ...overrides,
  };
}

describe('Notifications API E2E (Phase 8 M2)', () => {
  jest.setTimeout(60000);

  let app: INestApplication;
  let resolver: RecipientResolverService;

  const tokens: Record<string, string> = {};
  const userIds: Record<string, string> = {};

  let authorArticleId: string;
  let inactiveAuthorArticleId: string;
  let readUserUnreadId: string;
  let readUserReadId: string;
  let readUserAlreadyReadAt: Date;

  async function cleanupTestData(): Promise<void> {
    const users = await prisma.user.findMany({
      where: { email: { in: Object.values(TEST_EMAILS) } },
      select: { id: true },
    });
    const ids = users.map((user) => user.id);

    if (ids.length > 0) {
      await prisma.notification.deleteMany({ where: { recipientId: { in: ids } } });
      await prisma.article.deleteMany({
        where: {
          OR: [
            { primaryAuthorId: { in: ids } },
            { createdBy: { in: ids } },
            { slug: { startsWith: SLUG_PREFIX } },
          ],
        },
      });
      await prisma.userRole.deleteMany({ where: { userId: { in: ids } } });
      await prisma.refreshSession.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }

    await prisma.article.deleteMany({ where: { slug: { startsWith: SLUG_PREFIX } } });
  }

  async function registerUser(key: keyof typeof TEST_EMAILS): Promise<void> {
    const email = TEST_EMAILS[key];
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: PASSWORD, displayName: `Notifications E2E ${key}` });

    expect(response.status).toBe(201);
    tokens[key] = response.body.accessToken;
    userIds[key] = response.body.user.id;
  }

  async function assignRole(userId: string, roleName: string): Promise<void> {
    const role = await prisma.role.findUnique({ where: { name: roleName } });
    if (!role) {
      throw new Error(`Required seed role "${roleName}" is missing from the test database`);
    }
    await prisma.userRole.create({ data: { userId, roleId: role.id } });
  }

  async function getExpectedEditorIds(actorId: string | null): Promise<Set<string>> {
    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        ...(actorId ? { id: { not: actorId } } : {}),
        roles: {
          some: {
            role: {
              permissions: {
                some: { permission: { name: 'article.start-review' } },
              },
            },
          },
        },
      },
      select: { id: true },
    });
    return new Set(users.map((user) => user.id));
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    resolver = app.get(RecipientResolverService);

    await cleanupTestData();

    for (const key of Object.keys(TEST_EMAILS) as (keyof typeof TEST_EMAILS)[]) {
      await registerUser(key);
    }

    await assignRole(userIds.editor, 'editor');
    await assignRole(userIds.admin, 'admin');
    await assignRole(userIds.inactiveEditor, 'editor');

    await prisma.user.update({
      where: { id: userIds.inactiveEditor },
      data: { isActive: false },
    });
    await prisma.user.update({
      where: { id: userIds.inactiveAuthor },
      data: { isActive: false },
    });

    // ── Author list fixtures: five rows; two share createdAt to prove the
    //    deterministic `id ASC` tie-breaker, one is already read.
    await prisma.notification.createMany({
      data: [
        notificationFixture(userIds.author, {
          id: AUTHOR_NOTIFICATION_IDS.oldestRead,
          title: 'Oldest (read)',
          createdAt: new Date('2026-10-01T00:00:00.000Z'),
          readAt: new Date('2026-10-20T00:00:00.000Z'),
        }),
        notificationFixture(userIds.author, {
          id: AUTHOR_NOTIFICATION_IDS.second,
          title: 'Second',
          createdAt: new Date('2026-10-02T00:00:00.000Z'),
        }),
        notificationFixture(userIds.author, {
          id: AUTHOR_NOTIFICATION_IDS.third,
          title: 'Third',
          createdAt: new Date('2026-10-03T00:00:00.000Z'),
        }),
        notificationFixture(userIds.author, {
          id: AUTHOR_NOTIFICATION_IDS.tieA,
          title: 'Tie A',
          createdAt: new Date('2026-10-04T00:00:00.000Z'),
        }),
        notificationFixture(userIds.author, {
          id: AUTHOR_NOTIFICATION_IDS.tieB,
          title: 'Tie B',
          createdAt: new Date('2026-10-04T00:00:00.000Z'),
        }),
      ],
    });

    // ── Isolation fixture: the editor has their own rows.
    await prisma.notification.createMany({
      data: [
        notificationFixture(userIds.editor, { title: 'Editor row 1' }),
        notificationFixture(userIds.editor, { title: 'Editor row 2' }),
      ],
    });

    // ── Mark-read fixtures.
    readUserAlreadyReadAt = new Date('2026-10-10T00:00:00.000Z');
    const readUserRows = await prisma.notification.createManyAndReturn({
      data: [
        notificationFixture(userIds.readUser, {
          title: 'Read user unread',
          createdAt: new Date('2026-10-12T00:00:00.000Z'),
        }),
        notificationFixture(userIds.readUser, {
          title: 'Read user already read',
          createdAt: new Date('2026-10-11T00:00:00.000Z'),
          readAt: readUserAlreadyReadAt,
        }),
      ],
      select: { id: true, title: true },
    });
    readUserUnreadId = readUserRows.find((row) => row.title === 'Read user unread')!.id;
    readUserReadId = readUserRows.find((row) => row.title === 'Read user already read')!.id;

    // ── Read-all fixtures: three unread + one already read.
    await prisma.notification.createMany({
      data: [
        notificationFixture(userIds.readAllUser, { title: 'Read-all 1' }),
        notificationFixture(userIds.readAllUser, { title: 'Read-all 2' }),
        notificationFixture(userIds.readAllUser, { title: 'Read-all 3' }),
        notificationFixture(userIds.readAllUser, {
          title: 'Read-all already read',
          readAt: new Date('2026-10-09T00:00:00.000Z'),
        }),
      ],
    });

    // ── Another user's row (foreign IDOR target).
    await prisma.notification.create({
      data: notificationFixture(userIds.outsider, { title: 'Outsider row' }),
    });

    // ── Articles used by recipient resolution (author targeting).
    const authorArticle = await prisma.article.create({
      data: {
        slug: `${SLUG_PREFIX}author-${randomUUID()}`,
        primaryAuthorId: userIds.author,
        createdBy: userIds.author,
      },
    });
    authorArticleId = authorArticle.id;

    const inactiveAuthorArticle = await prisma.article.create({
      data: {
        slug: `${SLUG_PREFIX}inactive-author-${randomUUID()}`,
        primaryAuthorId: userIds.inactiveAuthor,
        createdBy: userIds.author,
      },
    });
    inactiveAuthorArticleId = inactiveAuthorArticle.id;
  });

  afterAll(async () => {
    try {
      await cleanupTestData();
    } finally {
      await app.close();
    }
  });

  describe('Authentication', () => {
    it.each([
      ['get', '/v1/notifications'],
      ['get', '/v1/notifications/unread-count'],
      ['patch', '/v1/notifications/00000000-0000-4000-8000-000000000001/read'],
      ['post', '/v1/notifications/read-all'],
    ])('requires authentication for %s %s', async (method, path) => {
      const response = await (request(app.getHttpServer()) as any)[method](path);
      expect(response.status).toBe(401);
    });

    it('rejects an invalid bearer token', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/notifications')
        .set(auth('not-a-valid-token'));
      expect(response.status).toBe(401);
    });
  });

  describe('GET /v1/notifications', () => {
    it('returns only the caller notifications with the documented fields', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/notifications')
        .set(auth(tokens.author));

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(5);
      expect(response.body.page).toBe(1);
      expect(response.body.limit).toBe(20);
      expect(response.body.data).toHaveLength(5);
      expect(response.body.data.map((row: any) => row.id)).toEqual([
        AUTHOR_NOTIFICATION_IDS.tieA,
        AUTHOR_NOTIFICATION_IDS.tieB,
        AUTHOR_NOTIFICATION_IDS.third,
        AUTHOR_NOTIFICATION_IDS.second,
        AUTHOR_NOTIFICATION_IDS.oldestRead,
      ]);
      expect(Object.keys(response.body.data[0]).sort()).toEqual(
        ['articleId', 'body', 'createdAt', 'id', 'readAt', 'title', 'type'].sort(),
      );
      expect(response.body.data[0]).not.toHaveProperty('recipientId');
      expect(response.body.data[0]).not.toHaveProperty('dedupeKey');
      expect(response.body.data[0]).not.toHaveProperty('emailStatus');
    });

    it('does not leak another user notifications', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/notifications')
        .set(auth(tokens.editor));

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(2);
      expect(response.body.data).toHaveLength(2);
      for (const row of response.body.data) {
        expect(row.id).not.toBe(AUTHOR_NOTIFICATION_IDS.tieA);
        expect(row.title).toMatch(/^Editor row/);
      }

      const authorResponse = await request(app.getHttpServer())
        .get('/v1/notifications')
        .set(auth(tokens.author));
      for (const row of authorResponse.body.data) {
        expect(row.title).not.toMatch(/^Editor row/);
      }
    });

    it('paginates deterministically and reports total across pages', async () => {
      const first = await request(app.getHttpServer())
        .get('/v1/notifications?page=1&limit=2')
        .set(auth(tokens.author));
      expect(first.status).toBe(200);
      expect(first.body.total).toBe(5);
      expect(first.body.data.map((row: any) => row.id)).toEqual([
        AUTHOR_NOTIFICATION_IDS.tieA,
        AUTHOR_NOTIFICATION_IDS.tieB,
      ]);

      const second = await request(app.getHttpServer())
        .get('/v1/notifications?page=2&limit=2')
        .set(auth(tokens.author));
      expect(second.status).toBe(200);
      expect(second.body.total).toBe(5);
      expect(second.body.data.map((row: any) => row.id)).toEqual([
        AUTHOR_NOTIFICATION_IDS.third,
        AUTHOR_NOTIFICATION_IDS.second,
      ]);

      const third = await request(app.getHttpServer())
        .get('/v1/notifications?page=3&limit=2')
        .set(auth(tokens.author));
      expect(third.status).toBe(200);
      expect(third.body.data.map((row: any) => row.id)).toEqual([
        AUTHOR_NOTIFICATION_IDS.oldestRead,
      ]);

      const beyond = await request(app.getHttpServer())
        .get('/v1/notifications?page=10&limit=2')
        .set(auth(tokens.author));
      expect(beyond.status).toBe(200);
      expect(beyond.body.total).toBe(5);
      expect(beyond.body.data).toEqual([]);
    });

    it('filters unread notifications only when unreadOnly=true', async () => {
      const unread = await request(app.getHttpServer())
        .get('/v1/notifications?unreadOnly=true')
        .set(auth(tokens.author));
      expect(unread.status).toBe(200);
      expect(unread.body.total).toBe(4);
      expect(unread.body.data.map((row: any) => row.id)).toEqual([
        AUTHOR_NOTIFICATION_IDS.tieA,
        AUTHOR_NOTIFICATION_IDS.tieB,
        AUTHOR_NOTIFICATION_IDS.third,
        AUTHOR_NOTIFICATION_IDS.second,
      ]);
      for (const row of unread.body.data) {
        expect(row.readAt).toBeNull();
      }

      const all = await request(app.getHttpServer())
        .get('/v1/notifications?unreadOnly=false')
        .set(auth(tokens.author));
      expect(all.status).toBe(200);
      expect(all.body.total).toBe(5);
    });

    it.each([
      'page=0',
      'page=-1',
      'page=abc',
      'page=1.5',
      'limit=0',
      'limit=-1',
      'limit=101',
      'limit=abc',
      'limit=1.5',
    ])('returns 400 for invalid pagination (%s)', async (query) => {
      const response = await request(app.getHttpServer())
        .get(`/v1/notifications?${query}`)
        .set(auth(tokens.author));
      expect(response.status).toBe(400);
    });

    it('accepts the pagination boundaries', async () => {
      const minimum = await request(app.getHttpServer())
        .get('/v1/notifications?page=1&limit=1')
        .set(auth(tokens.author));
      expect(minimum.status).toBe(200);
      expect(minimum.body.limit).toBe(1);
      expect(minimum.body.data).toHaveLength(1);

      const maximum = await request(app.getHttpServer())
        .get('/v1/notifications?page=1&limit=100')
        .set(auth(tokens.author));
      expect(maximum.status).toBe(200);
      expect(maximum.body.limit).toBe(100);
      expect(maximum.body.data).toHaveLength(5);
    });
  });

  describe('GET /v1/notifications/unread-count', () => {
    it('counts only the caller unread notifications', async () => {
      const authorResponse = await request(app.getHttpServer())
        .get('/v1/notifications/unread-count')
        .set(auth(tokens.author));
      expect(authorResponse.status).toBe(200);
      expect(authorResponse.body).toEqual({ unread: 4 });

      const editorResponse = await request(app.getHttpServer())
        .get('/v1/notifications/unread-count')
        .set(auth(tokens.editor));
      expect(editorResponse.status).toBe(200);
      expect(editorResponse.body).toEqual({ unread: 2 });
    });
  });

  describe('PATCH /v1/notifications/:id/read', () => {
    it('marks the caller notification as read and is idempotent', async () => {
      const first = await request(app.getHttpServer())
        .patch(`/v1/notifications/${readUserUnreadId}/read`)
        .set(auth(tokens.readUser));
      expect(first.status).toBe(200);
      expect(first.body.id).toBe(readUserUnreadId);
      expect(first.body.readAt).toEqual(expect.any(String));

      const firstReadAt = first.body.readAt;

      const second = await request(app.getHttpServer())
        .patch(`/v1/notifications/${readUserUnreadId}/read`)
        .set(auth(tokens.readUser));
      expect(second.status).toBe(200);
      expect(second.body.readAt).toBe(firstReadAt);

      const stored = await prisma.notification.findUnique({ where: { id: readUserUnreadId } });
      expect(stored!.readAt!.toISOString()).toBe(firstReadAt);

      const count = await request(app.getHttpServer())
        .get('/v1/notifications/unread-count')
        .set(auth(tokens.readUser));
      expect(count.body).toEqual({ unread: 0 });
    });

    it('returns the existing readAt for an already-read notification without changing it', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/v1/notifications/${readUserReadId}/read`)
        .set(auth(tokens.readUser));

      expect(response.status).toBe(200);
      expect(response.body.readAt).toBe(readUserAlreadyReadAt.toISOString());

      const stored = await prisma.notification.findUnique({ where: { id: readUserReadId } });
      expect(stored!.readAt!.toISOString()).toBe(readUserAlreadyReadAt.toISOString());
    });

    it('returns 404 for another user notification and leaves it untouched', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/v1/notifications/${AUTHOR_NOTIFICATION_IDS.third}/read`)
        .set(auth(tokens.outsider));

      expect(response.status).toBe(404);

      const stored = await prisma.notification.findUnique({
        where: { id: AUTHOR_NOTIFICATION_IDS.third },
      });
      expect(stored!.readAt).toBeNull();
    });

    it('returns 404 for a missing notification', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/v1/notifications/${randomUUID()}/read`)
        .set(auth(tokens.author));

      expect(response.status).toBe(404);
    });
  });

  describe('POST /v1/notifications/read-all', () => {
    it('marks all caller unread notifications read and returns the count', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/notifications/read-all')
        .set(auth(tokens.readAllUser));

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ updated: 3 });

      const repeated = await request(app.getHttpServer())
        .post('/v1/notifications/read-all')
        .set(auth(tokens.readAllUser));
      expect(repeated.status).toBe(200);
      expect(repeated.body).toEqual({ updated: 0 });

      const count = await request(app.getHttpServer())
        .get('/v1/notifications/unread-count')
        .set(auth(tokens.readAllUser));
      expect(count.body).toEqual({ unread: 0 });

      const rows = await prisma.notification.findMany({
        where: { recipientId: userIds.readAllUser },
      });
      expect(rows).toHaveLength(4);
      expect(rows.every((row) => row.readAt !== null)).toBe(true);
    });

    it('does not touch another user unread notifications', async () => {
      const before = await request(app.getHttpServer())
        .get('/v1/notifications/unread-count')
        .set(auth(tokens.author));
      expect(before.body).toEqual({ unread: 4 });

      await request(app.getHttpServer())
        .post('/v1/notifications/read-all')
        .set(auth(tokens.readAllUser));

      const after = await request(app.getHttpServer())
        .get('/v1/notifications/unread-count')
        .set(auth(tokens.author));
      expect(after.body).toEqual({ unread: 4 });
    });
  });

  describe('Recipient resolution (real database)', () => {
    it('selects editors by article.start-review permission, excluding the actor and inactive users', async () => {
      const recipients = await resolver.resolveEditorRecipients(userIds.editor);
      const recipientIds = new Set(recipients.map((recipient) => recipient.id));
      const expectedIds = await getExpectedEditorIds(userIds.editor);

      expect(recipientIds).toEqual(expectedIds);
      expect(recipientIds.has(userIds.admin)).toBe(true);
      expect(recipientIds.has(userIds.editor)).toBe(false);
      expect(recipientIds.has(userIds.inactiveEditor)).toBe(false);
      expect(recipientIds.has(userIds.inactiveAuthor)).toBe(false);
      expect(recipientIds.has(userIds.author)).toBe(false);

      const activeUsers = await prisma.user.findMany({
        where: { id: { in: [...recipientIds] } },
        select: { id: true, isActive: true },
      });
      expect(activeUsers.every((user) => user.isActive)).toBe(true);
    });

    it('includes the acting editor when there is no human actor (scheduler failure)', async () => {
      const recipients = await resolver.resolveEditorRecipients(null);
      const recipientIds = new Set(recipients.map((recipient) => recipient.id));
      const expectedIds = await getExpectedEditorIds(null);

      expect(recipientIds).toEqual(expectedIds);
      expect(recipientIds.has(userIds.editor)).toBe(true);
      expect(recipientIds.has(userIds.admin)).toBe(true);
      expect(recipientIds.has(userIds.inactiveEditor)).toBe(false);
    });

    it('targets the article primary author for author events', async () => {
      const approved = await resolver.resolveRecipientsForEvent(
        NotificationType.ARTICLE_APPROVED,
        { id: authorArticleId, primaryAuthorId: userIds.author },
        userIds.editor,
      );
      expect(approved).toEqual([{ id: userIds.author, email: TEST_EMAILS.author }]);

      const rejected = await resolver.resolveRecipientsForEvent(
        NotificationType.ARTICLE_REJECTED,
        { id: authorArticleId, primaryAuthorId: userIds.author },
        userIds.editor,
      );
      expect(rejected).toEqual([{ id: userIds.author, email: TEST_EMAILS.author }]);
    });

    it('produces no author notification for an inactive primary author', async () => {
      const author = await prisma.article.findUnique({
        where: { id: inactiveAuthorArticleId },
        select: { primaryAuthorId: true },
      });
      expect(author!.primaryAuthorId).toBe(userIds.inactiveAuthor);

      const recipients = await resolver.resolveRecipientsForEvent(
        NotificationType.ARTICLE_APPROVED,
        { id: inactiveAuthorArticleId, primaryAuthorId: author!.primaryAuthorId },
        userIds.editor,
      );
      expect(recipients).toEqual([]);
    });

    it('excludes the acting user from author notifications', async () => {
      const recipients = await resolver.resolveRecipientsForEvent(
        NotificationType.ARTICLE_REJECTED,
        { id: authorArticleId, primaryAuthorId: userIds.author },
        userIds.author,
      );
      expect(recipients).toEqual([]);
    });

    it('resolves the editor set for submitted-for-review and scheduler failures', async () => {
      const submitted = await resolver.resolveRecipientsForEvent(
        NotificationType.ARTICLE_SUBMITTED_FOR_REVIEW,
        { id: authorArticleId, primaryAuthorId: userIds.author },
        userIds.author,
      );
      const submittedIds = new Set(submitted.map((recipient) => recipient.id));
      expect(submittedIds).toEqual(await getExpectedEditorIds(userIds.author));
      expect(submittedIds.has(userIds.admin)).toBe(true);

      const failed = await resolver.resolveRecipientsForEvent(
        NotificationType.ARTICLE_FAILED_TO_PUBLISH,
        { id: authorArticleId, primaryAuthorId: userIds.author },
        null,
      );
      const failedIds = new Set(failed.map((recipient) => recipient.id));
      expect(failedIds).toEqual(await getExpectedEditorIds(null));
      expect(failedIds.has(userIds.editor)).toBe(true);
      expect(failedIds.has(userIds.admin)).toBe(true);
    });

    it('never returns duplicate recipients', async () => {
      const recipients = await resolver.resolveEditorRecipients(null);
      const ids = recipients.map((recipient) => recipient.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('Duplicate suppression (AC-7)', () => {
    it('rejects a replayed (recipientId, dedupeKey) insert and keeps exactly one row', async () => {
      const dedupeKey = `article-approved:e2e:${randomUUID()}`;

      await prisma.notification.create({
        data: notificationFixture(userIds.outsider, { dedupeKey }),
      });

      await expect(
        prisma.notification.create({
          data: notificationFixture(userIds.outsider, { dedupeKey }),
        }),
      ).rejects.toMatchObject({ code: 'P2002' });

      const count = await prisma.notification.count({
        where: { recipientId: userIds.outsider, dedupeKey },
      });
      expect(count).toBe(1);
    });
  });
});
