import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationType } from '@dailystar/types';
import { AppModule } from '../src/app.module';
import { prisma } from '../src/database/client';
import {
  TerminalPublicationError,
  WorkflowService,
} from '../src/modules/workflow/workflow.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { EmailDispatchService } from '../src/modules/notifications/email/email-dispatch.service';

const RUN_ID = randomUUID();
const SLUG_PREFIX = `phase8-m4-workflow-${RUN_ID}-`;
const EMAIL_PREFIX = `phase8-m4-workflow-${RUN_ID}`;
const PASSWORD_HASH = 'not-a-real-password-hash';

interface TestUser {
  id: string;
  email: string;
  displayName: string;
}

describe('Workflow notification integration E2E (Phase 8 M4)', () => {
  jest.setTimeout(120_000);

  let app: INestApplication;
  let workflow: WorkflowService;
  let notifications: NotificationsService;
  let emailDispatch: EmailDispatchService;

  const users: Record<string, TestUser> = {};

  function authorContext(userId: string) {
    return { sub: userId, permissions: [] as string[] };
  }

  function editorContext(userId: string) {
    return { sub: userId, permissions: ['article.read.any'] };
  }

  async function cleanupTestData(): Promise<void> {
    const testUsers = await prisma.user.findMany({
      where: { email: { startsWith: EMAIL_PREFIX } },
      select: { id: true },
    });
    const userIds = testUsers.map((user) => user.id);

    const testArticles = await prisma.article.findMany({
      where: { slug: { startsWith: SLUG_PREFIX } },
      select: { id: true },
    });
    const articleIds = testArticles.map((article) => article.id);

    await prisma.notification.deleteMany({
      where: {
        OR: [
          ...(userIds.length > 0 ? [{ recipientId: { in: userIds } }] : []),
          ...(articleIds.length > 0 ? [{ articleId: { in: articleIds } }] : []),
        ],
      },
    });

    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          ...(userIds.length > 0 ? [{ actorId: { in: userIds } }] : []),
          ...(articleIds.length > 0 ? [{ entityId: { in: articleIds } }] : []),
        ],
      },
    });

    if (articleIds.length > 0) {
      await prisma.publicationSchedule.deleteMany({
        where: { articleId: { in: articleIds } },
      });
      await prisma.article.deleteMany({ where: { id: { in: articleIds } } });
    }

    if (userIds.length > 0) {
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.refreshSession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
  }

  async function createUser(
    key: string,
    options: { role?: string; isActive?: boolean; displayName?: string } = {},
  ): Promise<TestUser> {
    const email = `${EMAIL_PREFIX}-${key}@dailystar.local`;
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: PASSWORD_HASH,
        displayName: options.displayName ?? `M4 ${key}`,
        isActive: options.isActive ?? true,
      },
    });

    if (options.role) {
      const role = await prisma.role.findUnique({ where: { name: options.role } });
      if (!role) {
        throw new Error(`Required seed role "${options.role}" is missing from the test database`);
      }
      await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
    }

    const testUser = { id: user.id, email: user.email, displayName: user.displayName! };
    users[key] = testUser;
    return testUser;
  }

  async function createDraftArticle(
    authorId: string,
    title: string,
  ): Promise<{ articleId: string; revisionId: string; version: number }> {
    const article = await prisma.article.create({
      data: {
        slug: `${SLUG_PREFIX}${randomUUID()}`,
        primaryAuthorId: authorId,
        createdBy: authorId,
      },
    });

    const revision = await prisma.articleRevision.create({
      data: {
        articleId: article.id,
        authorId,
        revisionNumber: 1,
        title,
        body: 'M4 workflow notification fixture body.',
      },
    });

    const updated = await prisma.article.update({
      where: { id: article.id },
      data: { currentRevisionId: revision.id },
    });

    return { articleId: updated.id, revisionId: revision.id, version: updated.version };
  }

  async function createScheduledArticle(
    authorId: string,
    title: string,
    options: {
      scheduleStatus?: 'PENDING' | 'CANCELLED' | 'FAILED' | 'EXECUTED';
      expectedVersionOffset?: number;
      revisionOverride?: string;
      deleted?: boolean;
    } = {},
  ): Promise<{ articleId: string; revisionId: string; scheduleId: string; version: number }> {
    const draft = await createDraftArticle(authorId, title);

    const scheduled = await prisma.article.update({
      where: { id: draft.articleId },
      data: {
        status: 'SCHEDULED',
        approvedRevisionId: draft.revisionId,
        version: { increment: 1 },
        ...(options.deleted ? { deletedAt: new Date() } : {}),
      },
    });

    const schedule = await prisma.publicationSchedule.create({
      data: {
        articleId: draft.articleId,
        scheduledFor: new Date(Date.now() + 10 * 60_000),
        status: options.scheduleStatus ?? 'PENDING',
        scheduledById: users.editor.id,
        expectedArticleVersion: scheduled.version + (options.expectedVersionOffset ?? 0),
        approvedRevisionId: options.revisionOverride ?? draft.revisionId,
      },
    });

    return {
      articleId: draft.articleId,
      revisionId: draft.revisionId,
      scheduleId: schedule.id,
      version: scheduled.version,
    };
  }

  async function expectedEditorIds(actorId: string | null): Promise<string[]> {
    const recipients = await prisma.user.findMany({
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
      orderBy: { id: 'asc' },
    });

    return recipients.map((recipient) => recipient.id);
  }

  async function notificationsForDedupe(dedupeKey: string) {
    return prisma.notification.findMany({
      where: { dedupeKey },
      orderBy: { recipientId: 'asc' },
    });
  }

  async function moveToUnderReview(articleId: string, authorId: string) {
    const submitted = await workflow.submitReview(
      articleId,
      authorContext(authorId),
      (await prisma.article.findUniqueOrThrow({ where: { id: articleId } })).version,
    );
    return workflow.startReview(
      submitted.id,
      editorContext(users.editor.id),
      submitted.version,
    );
  }

  function uniqueRecipientIds(rows: Array<{ recipientId: string }>): string[] {
    return Array.from(new Set(rows.map((row) => row.recipientId))).sort();
  }

  beforeAll(async () => {
    process.env.EMAIL_PROVIDER = 'log';
    process.env.EMAIL_RECONCILE_ENABLED = 'false';
    delete process.env.POSTMARK_SERVER_TOKEN;

    await cleanupTestData();

    await createUser('author', { displayName: 'M4 Author' });
    await createUser('editor', {
      role: 'editor',
      displayName: 'M4 Editor',
    });
    await createUser('admin', { role: 'admin', displayName: 'M4 Admin' });
    await createUser('submittingEditor', {
      role: 'editor',
      displayName: 'M4 Submitting Editor',
    });
    await createUser('inactiveEditor', {
      role: 'editor',
      isActive: false,
      displayName: 'M4 Inactive Editor',
    });
    await createUser('inactiveAuthor', {
      isActive: false,
      displayName: 'M4 Inactive Author',
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    workflow = app.get(WorkflowService);
    notifications = app.get(NotificationsService);
    emailDispatch = app.get(EmailDispatchService);
  });

  afterAll(async () => {
    try {
      await cleanupTestData();
    } finally {
      await app?.close();
    }
  });

  describe('ARTICLE_SUBMITTED_FOR_REVIEW', () => {
    it('creates one notification per active editor, excludes the actor and inactive users, and preserves the snapshot', async () => {
      const draft = await createDraftArticle(users.author.id, 'M4 Submitted Article');

      const result = await workflow.submitReview(
        draft.articleId,
        authorContext(users.author.id),
        draft.version,
      );

      const dedupeKey = `article-submitted:${draft.articleId}:${result.version}`;
      const rows = await notificationsForDedupe(dedupeKey);
      const expectedRecipients = await expectedEditorIds(users.author.id);

      expect(uniqueRecipientIds(rows)).toEqual(expectedRecipients);
      expect(rows).toHaveLength(expectedRecipients.length);
      expect(rows.every((row) => row.recipientId !== users.author.id)).toBe(true);
      expect(rows.every((row) => row.recipientId !== users.inactiveEditor.id)).toBe(true);
      expect(rows[0]).toMatchObject({
        type: 'ARTICLE_SUBMITTED_FOR_REVIEW',
        title: 'Article submitted for review',
        body: '“M4 Submitted Article” was submitted for review by M4 Author.',
        articleId: draft.articleId,
        data: { articleVersion: result.version },
      });
    });

    it('excludes a submitting editor who is also an eligible editor', async () => {
      const draft = await createDraftArticle(users.submittingEditor.id, 'M4 Editor Authored');

      const result = await workflow.submitReview(
        draft.articleId,
        authorContext(users.submittingEditor.id),
        draft.version,
      );

      const dedupeKey = `article-submitted:${draft.articleId}:${result.version}`;
      const rows = await notificationsForDedupe(dedupeKey);
      const expectedRecipients = await expectedEditorIds(users.submittingEditor.id);

      expect(uniqueRecipientIds(rows)).toEqual(expectedRecipients);
      expect(rows.every((row) => row.recipientId !== users.submittingEditor.id)).toBe(true);
    });

    it('does not duplicate rows when the same event is replayed', async () => {
      const draft = await createDraftArticle(users.author.id, 'M4 Dedupe Replay');

      const result = await workflow.submitReview(
        draft.articleId,
        authorContext(users.author.id),
        draft.version,
      );
      const dedupeKey = `article-submitted:${draft.articleId}:${result.version}`;
      const before = await notificationsForDedupe(dedupeKey);

      const replayed = await prisma.$transaction((tx) =>
        notifications.createForEventSafely(tx, {
          type: NotificationType.ARTICLE_SUBMITTED_FOR_REVIEW,
          articleId: draft.articleId,
          primaryAuthorId: users.author.id,
          actorId: users.author.id,
          dedupeKey,
          title: 'Article submitted for review',
          body: 'Replay must be suppressed by the unique key.',
          data: { articleVersion: result.version },
        }),
      );

      const after = await notificationsForDedupe(dedupeKey);
      expect(replayed).toEqual([]);
      expect(after).toHaveLength(before.length);
      expect(after.map((row) => row.id).sort()).toEqual(before.map((row) => row.id).sort());
    });
  });

  describe('ARTICLE_APPROVED / ARTICLE_REJECTED', () => {
    it('approve creates exactly one notification for the active author', async () => {
      const draft = await createDraftArticle(users.author.id, 'M4 Approved Article');
      const underReview = await moveToUnderReview(draft.articleId, users.author.id);

      const approved = await workflow.approve(
        draft.articleId,
        editorContext(users.editor.id),
        underReview.version,
      );

      const rows = await notificationsForDedupe(
        `article-approved:${draft.articleId}:${approved.version}`,
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        recipientId: users.author.id,
        type: 'ARTICLE_APPROVED',
        title: 'Article approved',
        body: '“M4 Approved Article” was approved by M4 Editor.',
        articleId: draft.articleId,
        data: { articleVersion: approved.version },
      });
    });

    it('approve creates a single row when the author also holds the editor permission', async () => {
      const draft = await createDraftArticle(users.submittingEditor.id, 'M4 Author Is Editor');
      const underReview = await moveToUnderReview(draft.articleId, users.submittingEditor.id);

      const approved = await workflow.approve(
        draft.articleId,
        editorContext(users.editor.id),
        underReview.version,
      );

      const rows = await notificationsForDedupe(
        `article-approved:${draft.articleId}:${approved.version}`,
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].recipientId).toBe(users.submittingEditor.id);
    });

    it('reject creates exactly one notification for the active author', async () => {
      const draft = await createDraftArticle(users.author.id, 'M4 Rejected Article');
      const underReview = await moveToUnderReview(draft.articleId, users.author.id);

      const rejected = await workflow.reject(
        draft.articleId,
        editorContext(users.editor.id),
        underReview.version,
        'Needs stronger sources',
      );

      const rows = await notificationsForDedupe(
        `article-rejected:${draft.articleId}:${rejected.version}`,
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        recipientId: users.author.id,
        type: 'ARTICLE_REJECTED',
        title: 'Article rejected',
        body: '“M4 Rejected Article” was rejected by M4 Editor.',
        articleId: draft.articleId,
      });
    });

    it.each([
      ['approve', 'ARTICLE_APPROVED'],
      ['reject', 'ARTICLE_REJECTED'],
    ])('%s creates no notification for an inactive author', async (action, type) => {
      const draft = await createDraftArticle(users.inactiveAuthor.id, `M4 Inactive ${action}`);
      const underReview = await moveToUnderReview(draft.articleId, users.inactiveAuthor.id);

      if (action === 'approve') {
        await workflow.approve(
          draft.articleId,
          editorContext(users.editor.id),
          underReview.version,
        );
      } else {
        await workflow.reject(
          draft.articleId,
          editorContext(users.editor.id),
          underReview.version,
          'No active author',
        );
      }

      const rows = await prisma.notification.findMany({
        where: { articleId: draft.articleId, type: type as NotificationType },
      });
      expect(rows).toEqual([]);
    });

    it('requestChanges produces no notification side effect (OD-2 deferred)', async () => {
      const draft = await createDraftArticle(users.author.id, 'M4 Changes Requested');
      const underReview = await moveToUnderReview(draft.articleId, users.author.id);

      const before = await prisma.notification.count({
        where: { articleId: draft.articleId },
      });

      await workflow.requestChanges(
        draft.articleId,
        editorContext(users.editor.id),
        underReview.version,
        'Please revise',
      );

      const after = await prisma.notification.findMany({
        where: { articleId: draft.articleId },
      });
      expect(after).toHaveLength(before);
      // `ARTICLE_CHANGES_REQUESTED` is intentionally absent from NotificationType,
      // so no such event can be persisted for the deferred OD-2 requirement.
      expect(Object.values(NotificationType)).not.toContain('ARTICLE_CHANGES_REQUESTED');
    });
  });

  describe('Failure containment', () => {
    it('rolls back only the notification savepoint and commits the Article transition', async () => {
      const draft = await createDraftArticle(users.author.id, 'M4 Insert Failure');

      await expect(
        prisma.$transaction(async (tx) => {
          await tx.article.update({
            where: { id: draft.articleId },
            data: {
              status: 'SUBMITTED_FOR_REVIEW',
              version: { increment: 1 },
              updatedBy: users.author.id,
            },
          });

          const created = await notifications.createForEventSafely(tx, {
            type: NotificationType.ARTICLE_SUBMITTED_FOR_REVIEW,
            articleId: draft.articleId,
            primaryAuthorId: users.author.id,
            actorId: users.author.id,
            // Exceeds the VarChar(200) column and forces a real PostgreSQL
            // insert error after the Article update has already executed.
            dedupeKey: 'x'.repeat(201),
            title: 'Article submitted for review',
            body: 'This insert must fail without aborting the workflow transaction.',
            data: { articleVersion: draft.version + 1 },
          });

          expect(created).toEqual([]);

          // Prove the transaction is still usable after the savepoint rollback.
          await tx.auditLog.create({
            data: {
              entityType: 'Article',
              entityId: draft.articleId,
              action: 'SUBMIT_FOR_REVIEW',
              actorId: users.author.id,
            },
          });
        }),
      ).resolves.toBeUndefined();

      const stored = await prisma.article.findUniqueOrThrow({
        where: { id: draft.articleId },
      });
      expect(stored.status).toBe('SUBMITTED_FOR_REVIEW');
      expect(stored.version).toBe(draft.version + 1);
      expect(await prisma.notification.count({ where: { articleId: draft.articleId } })).toBe(0);
      expect(
        await prisma.auditLog.count({
          where: { entityId: draft.articleId, action: 'SUBMIT_FOR_REVIEW' },
        }),
      ).toBe(1);
    });

    it('dispatches email only after the workflow transaction has committed', async () => {
      const draft = await createDraftArticle(users.author.id, 'M4 Post Commit Ordering');
      let statusObservedDuringDispatch: string | undefined;
      const originalDispatch = emailDispatch.dispatchEmailsSafely.bind(emailDispatch);

      const dispatchSpy = jest
        .spyOn(emailDispatch, 'dispatchEmailsSafely')
        .mockImplementation(async (notificationIds) => {
          const stored = await prisma.article.findUnique({
            where: { id: draft.articleId },
            select: { status: true },
          });
          statusObservedDuringDispatch = stored?.status;
          await originalDispatch(notificationIds);
        });

      try {
        await workflow.submitReview(
          draft.articleId,
          authorContext(users.author.id),
          draft.version,
        );
      } finally {
        dispatchSpy.mockRestore();
      }

      expect(statusObservedDuringDispatch).toBe('SUBMITTED_FOR_REVIEW');
      expect(
        await prisma.notification.count({
          where: { articleId: draft.articleId, type: 'ARTICLE_SUBMITTED_FOR_REVIEW' },
        }),
      ).toBeGreaterThan(0);
    });

    it('leaves durable notifications PENDING when email enqueue fails, without changing the workflow outcome', async () => {
      const draft = await createDraftArticle(users.author.id, 'M4 Enqueue Failure');
      const enqueueSpy = jest
        .spyOn(emailDispatch, 'enqueue')
        .mockRejectedValue(new Error('redis unavailable'));

      let result: { status: string; version: number };
      try {
        result = await workflow.submitReview(
          draft.articleId,
          authorContext(users.author.id),
          draft.version,
        );
      } finally {
        enqueueSpy.mockRestore();
      }

      expect(result.status).toBe('SUBMITTED_FOR_REVIEW');
      const rows = await prisma.notification.findMany({
        where: {
          articleId: draft.articleId,
          dedupeKey: `article-submitted:${draft.articleId}:${result.version}`,
        },
      });
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.emailStatus === 'PENDING')).toBe(true);
    });
  });

  describe('ARTICLE_FAILED_TO_PUBLISH scheduled failure paths', () => {
    async function expectFailureNotification(
      scheduleId: string,
      articleId: string,
      reason: string,
    ): Promise<void> {
      const rows = await notificationsForDedupe(`article-publish-failed:${scheduleId}`);
      const expectedRecipients = await expectedEditorIds(null);

      expect(uniqueRecipientIds(rows)).toEqual(expectedRecipients);
      expect(rows).toHaveLength(expectedRecipients.length);
      expect(rows.every((row) => row.recipientId !== users.inactiveEditor.id)).toBe(true);
      expect(rows[0]).toMatchObject({
        type: 'ARTICLE_FAILED_TO_PUBLISH',
        articleId,
        title: 'Article failed to publish',
        data: { scheduleId, reason },
      });
      expect(rows[0].body).toContain(reason);
    }

    it('successful scheduled publication creates no notification', async () => {
      const fixture = await createScheduledArticle(users.author.id, 'M4 Successful Publish');

      const published = await workflow.executeScheduledPublish(fixture.scheduleId);

      expect(published?.status).toBe('PUBLISHED');
      expect(
        await prisma.notification.count({ where: { articleId: fixture.articleId } }),
      ).toBe(0);
    });

    it('recordTerminalFailure emits exactly one notification per editor and is replay-safe', async () => {
      const fixture = await createScheduledArticle(users.author.id, 'M4 Terminal Failure');

      const failed = await workflow.recordTerminalFailure(
        fixture.scheduleId,
        'Scheduler recovery attempts exhausted',
      );

      expect(failed?.status).toBe('FAILED_TO_PUBLISH');
      await expectFailureNotification(
        fixture.scheduleId,
        fixture.articleId,
        'Scheduler recovery attempts exhausted',
      );

      const firstRows = await notificationsForDedupe(
        `article-publish-failed:${fixture.scheduleId}`,
      );
      const replay = await workflow.recordTerminalFailure(
        fixture.scheduleId,
        'Scheduler recovery attempts exhausted',
      );
      const secondRows = await notificationsForDedupe(
        `article-publish-failed:${fixture.scheduleId}`,
      );

      expect(replay).toBeNull();
      expect(secondRows.map((row) => row.id).sort()).toEqual(
        firstRows.map((row) => row.id).sort(),
      );
    });

    it('executeScheduledPublish emits exactly one notification per editor on VERSION_MISMATCH', async () => {
      const fixture = await createScheduledArticle(users.author.id, 'M4 Version Mismatch', {
        expectedVersionOffset: -1,
      });

      await expect(workflow.executeScheduledPublish(fixture.scheduleId)).rejects.toThrow(
        'VERSION_MISMATCH',
      );

      await expectFailureNotification(
        fixture.scheduleId,
        fixture.articleId,
        'VERSION_MISMATCH',
      );
    });

    it('executeScheduledPublish emits exactly one notification per editor on REVISION_MISMATCH', async () => {
      const fixture = await createScheduledArticle(users.author.id, 'M4 Revision Mismatch');
      const alternateRevision = await prisma.articleRevision.create({
        data: {
          articleId: fixture.articleId,
          authorId: users.author.id,
          revisionNumber: 2,
          title: 'M4 Revision Mismatch alternate',
          body: 'Alternate revision body.',
        },
      });
      await prisma.publicationSchedule.update({
        where: { id: fixture.scheduleId },
        data: { approvedRevisionId: alternateRevision.id },
      });

      await expect(workflow.executeScheduledPublish(fixture.scheduleId)).rejects.toThrow(
        'REVISION_MISMATCH',
      );

      await expectFailureNotification(
        fixture.scheduleId,
        fixture.articleId,
        'REVISION_MISMATCH',
      );
    });

    it('executeScheduledPublish emits exactly one notification per editor on APPROVED_REVISION_NOT_FOUND', async () => {
      const fixture = await createScheduledArticle(users.author.id, 'M4 Revision Missing');
      const otherArticle = await createDraftArticle(users.author.id, 'M4 Other Article');
      const foreignRevision = await prisma.articleRevision.findUniqueOrThrow({
        where: { id: otherArticle.revisionId },
      });

      await prisma.article.update({
        where: { id: fixture.articleId },
        data: { approvedRevisionId: foreignRevision.id },
      });
      await prisma.publicationSchedule.update({
        where: { id: fixture.scheduleId },
        data: { approvedRevisionId: foreignRevision.id },
      });

      await expect(workflow.executeScheduledPublish(fixture.scheduleId)).rejects.toThrow(
        'APPROVED_REVISION_NOT_FOUND',
      );

      await expectFailureNotification(
        fixture.scheduleId,
        fixture.articleId,
        'APPROVED_REVISION_NOT_FOUND',
      );
    });

    it('stale, cancelled, and soft-deleted schedules create no notification', async () => {
      const cancelled = await createScheduledArticle(users.author.id, 'M4 Cancelled Schedule', {
        scheduleStatus: 'CANCELLED',
      });
      const cancelledResult = await workflow.recordTerminalFailure(
        cancelled.scheduleId,
        'Late failure report',
      );
      expect(cancelledResult).toBeNull();
      expect(
        await notificationsForDedupe(`article-publish-failed:${cancelled.scheduleId}`),
      ).toEqual([]);

      const cancelledExecution = await createScheduledArticle(
        users.author.id,
        'M4 Cancelled Execution',
        { scheduleStatus: 'CANCELLED' },
      );
      await expect(
        workflow.executeScheduledPublish(cancelledExecution.scheduleId),
      ).rejects.toBeInstanceOf(TerminalPublicationError);
      expect(
        await notificationsForDedupe(
          `article-publish-failed:${cancelledExecution.scheduleId}`,
        ),
      ).toEqual([]);

      const deleted = await createScheduledArticle(users.author.id, 'M4 Soft Deleted', {
        deleted: true,
      });
      await expect(workflow.executeScheduledPublish(deleted.scheduleId)).rejects.toThrow(
        'Article deleted',
      );
      expect(
        await notificationsForDedupe(`article-publish-failed:${deleted.scheduleId}`),
      ).toEqual([]);

      const stale = await createScheduledArticle(users.author.id, 'M4 Stale Schedule');
      await prisma.article.update({
        where: { id: stale.articleId },
        data: { status: 'DRAFT' },
      });
      await expect(workflow.executeScheduledPublish(stale.scheduleId)).rejects.toThrow(
        'Article no longer SCHEDULED',
      );
      expect(
        await notificationsForDedupe(`article-publish-failed:${stale.scheduleId}`),
      ).toEqual([]);
    });
  });
});
