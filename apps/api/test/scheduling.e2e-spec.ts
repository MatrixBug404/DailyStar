import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from './../src/app.module';
import { prisma } from '../src/database/client';
import { WorkflowService } from '../src/modules/workflow/workflow.service';
import { SchedulingService } from '../src/modules/scheduling/scheduling.service';
import { getQueueToken } from '@nestjs/bullmq';

describe('Scheduling (Phase 7)', () => {
  jest.setTimeout(30000);
  let app: INestApplication;
  let authorSession: string;
  let editorSession: string;

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

    await prisma.publicationSchedule.deleteMany();
    await prisma.articleRevision.deleteMany();
    await prisma.article.deleteMany();

    await request(app.getHttpServer()).post('/auth/register').send({
      email: 'author_sched@dailystar.local',
      password: 'password123',
      displayName: 'Author',
    });
    const authorUser = await prisma.user.findUnique({
      where: { email: 'author_sched@dailystar.local' },
    });
    const authorRole = await prisma.role.findUnique({ where: { name: 'author' } });

    await request(app.getHttpServer()).post('/auth/register').send({
      email: 'editor_sched@dailystar.local',
      password: 'password123',
      displayName: 'Editor',
    });
    const editorUser = await prisma.user.findUnique({
      where: { email: 'editor_sched@dailystar.local' },
    });
    const editorRole = await prisma.role.findUnique({ where: { name: 'editor' } });

    if (!authorUser || !authorRole || !editorUser || !editorRole) throw new Error('Setup failed');

    await prisma.userRole.deleteMany({ where: { userId: authorUser.id } });
    await prisma.userRole.create({ data: { userId: authorUser.id, roleId: authorRole.id } });

    await prisma.userRole.deleteMany({ where: { userId: editorUser.id } });
    await prisma.userRole.create({ data: { userId: editorUser.id, roleId: editorRole.id } });

    const authorLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'author_sched@dailystar.local', password: 'password123' });
    authorSession = authorLogin.body.accessToken;

    const editorLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'editor_sched@dailystar.local', password: 'password123' });
    editorSession = editorLogin.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  let articleId: string;
  let currentVersion: number;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('1. Create, submit, approve article', async () => {
    let res = await request(app.getHttpServer())
      .post('/v1/articles')
      .set('Authorization', `Bearer ${authorSession}`)
      .send({ title: 'Sched Test', body: 'Content', tags: ['test'] });
    articleId = res.body.id;
    currentVersion = res.body.version;

    res = await request(app.getHttpServer())
      .post(`/v1/articles/${articleId}/submit-review`)
      .set('Authorization', `Bearer ${authorSession}`)
      .send({ expectedVersion: currentVersion });
    currentVersion = res.body.version;

    res = await request(app.getHttpServer())
      .post(`/v1/articles/${articleId}/start-review`)
      .set('Authorization', `Bearer ${editorSession}`)
      .send({ expectedVersion: currentVersion });
    currentVersion = res.body.version;

    res = await request(app.getHttpServer())
      .post(`/v1/articles/${articleId}/approve`)
      .set('Authorization', `Bearer ${editorSession}`)
      .send({ expectedVersion: currentVersion });
    currentVersion = res.body.version;
    expect(res.body.status).toBe('APPROVED');
  });

  it('2. Schedule article -> DB commit -> queue enqueue', async () => {
    const futureDate = new Date();
    futureDate.setMinutes(futureDate.getMinutes() + 10);

    const res = await request(app.getHttpServer())
      .post(`/v1/articles/${articleId}/schedule`)
      .set('Authorization', `Bearer ${editorSession}`)
      .send({ expectedVersion: currentVersion, scheduledFor: futureDate.toISOString() });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('SCHEDULED');
    currentVersion = res.body.version;

    // Check DB for schedule
    const schedules = await prisma.publicationSchedule.findMany({ where: { articleId } });
    expect(schedules.length).toBe(1);
    expect(schedules[0].status).toBe('PENDING');
    expect(schedules[0].expectedArticleVersion).toBe(currentVersion);
  });

  it('3. A scheduled article cannot be soft-deleted', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/v1/articles/${articleId}`)
      .set('Authorization', `Bearer ${authorSession}`);

    expect(res.status).toBe(409);

    const schedule = await prisma.publicationSchedule.findFirst({ where: { articleId } });
    expect(schedule?.status).toBe('PENDING');
    const article = await prisma.article.findUnique({ where: { id: articleId } });
    expect(article?.deletedAt).toBeNull();
  });

  it('4. Editing a scheduled article reverts it to DRAFT and a worker does not publish', async () => {
    const editRes = await request(app.getHttpServer())
      .patch(`/v1/articles/${articleId}`)
      .set('Authorization', `Bearer ${authorSession}`)
      .send({ title: 'Sched Test Edited', expectedVersion: currentVersion });

    expect(editRes.status).toBe(200);
    expect(editRes.body.status).toBe('DRAFT');
    currentVersion = editRes.body.version;

    const schedule = await prisma.publicationSchedule.findFirst({ where: { articleId } });
    expect(schedule?.status).toBe('CANCELLED');

    const workflowService = app.get(WorkflowService);
    await expect(workflowService.executeScheduledPublish(schedule!.id)).rejects.toThrow(
      'is no longer PENDING',
    );

    const article = await prisma.article.findUnique({ where: { id: articleId } });
    expect(article?.status).toBe('DRAFT');
  });

  it('5. An orphan PENDING schedule for a DRAFT article is cancelled, not failed', async () => {
    const schedule = await prisma.publicationSchedule.findFirst({ where: { articleId } });
    await prisma.publicationSchedule.update({
      where: { id: schedule!.id },
      data: { status: 'PENDING' },
    });

    const workflowService = app.get(WorkflowService);
    await expect(workflowService.executeScheduledPublish(schedule!.id)).rejects.toThrow(
      'Article no longer SCHEDULED',
    );

    const updatedSchedule = await prisma.publicationSchedule.findUnique({
      where: { id: schedule!.id },
    });
    expect(updatedSchedule?.status).toBe('CANCELLED');
    expect(updatedSchedule?.lastError).toBe('Article no longer SCHEDULED');

    const article = await prisma.article.findUnique({ where: { id: articleId } });
    expect(article?.status).toBe('DRAFT');

    const failureAudit = await prisma.auditLog.findFirst({
      where: { entityType: 'Article', entityId: articleId, action: 'PUBLISH_FAILED' },
    });
    expect(failureAudit).toBeNull();
  });

  it('6. Already-published intended revision reconciles to EXECUTED without a duplicate PUBLISH event', async () => {
    const schedule = await prisma.publicationSchedule.findFirst({ where: { articleId } });
    await prisma.publicationSchedule.update({
      where: { id: schedule!.id },
      data: { status: 'PENDING' },
    });
    await prisma.article.update({
      where: { id: articleId },
      data: {
        status: 'PUBLISHED',
        approvedRevisionId: schedule!.approvedRevisionId,
        currentPublishedRevisionId: schedule!.approvedRevisionId,
      },
    });

    const publishAuditsBefore = await prisma.auditLog.count({
      where: { entityType: 'Article', entityId: articleId, action: 'PUBLISH' },
    });

    const workflowService = app.get(WorkflowService);
    const result = await workflowService.executeScheduledPublish(schedule!.id);
    expect(result?.status).toBe('PUBLISHED');

    const updatedSchedule = await prisma.publicationSchedule.findUnique({
      where: { id: schedule!.id },
    });
    expect(updatedSchedule?.status).toBe('EXECUTED');

    const publishAuditsAfter = await prisma.auditLog.count({
      where: { entityType: 'Article', entityId: articleId, action: 'PUBLISH' },
    });
    expect(publishAuditsAfter).toBe(publishAuditsBefore);
  });

  it('7. Soft-deleting a non-scheduled article is allowed and an orphan PENDING schedule is cancelled', async () => {
    const delRes = await request(app.getHttpServer())
      .delete(`/v1/articles/${articleId}`)
      .set('Authorization', `Bearer ${authorSession}`);
    expect(delRes.status).toBe(200);

    const schedule = await prisma.publicationSchedule.findFirst({ where: { articleId } });
    await prisma.publicationSchedule.update({
      where: { id: schedule!.id },
      data: { status: 'PENDING' },
    });

    const workflowService = app.get(WorkflowService);
    await expect(workflowService.executeScheduledPublish(schedule!.id)).rejects.toThrow(
      'Article deleted',
    );

    const updatedSchedule = await prisma.publicationSchedule.findUnique({
      where: { id: schedule!.id },
    });
    expect(updatedSchedule?.status).toBe('CANCELLED');
    expect(updatedSchedule?.lastError).toBe('Article deleted');

    const article = await prisma.article.findUnique({ where: { id: articleId } });
    expect(article?.status).toBe('PUBLISHED');
    expect(article?.deletedAt).not.toBeNull();

    const failureAudit = await prisma.auditLog.findFirst({
      where: { entityType: 'Article', entityId: articleId, action: 'PUBLISH_FAILED' },
    });
    expect(failureAudit).toBeNull();
  });

  it('8. Concurrent scheduling and soft deletion cannot leave a deleted SCHEDULED article with a PENDING schedule', async () => {
    // Create and approve an independent article for the interleaving test.
    let res = await request(app.getHttpServer())
      .post('/v1/articles')
      .set('Authorization', `Bearer ${authorSession}`)
      .send({ title: 'Concurrent Delete Test', body: 'Content' });
    const concurrentArticleId = res.body.id;
    let version = res.body.version;

    res = await request(app.getHttpServer())
      .post(`/v1/articles/${concurrentArticleId}/submit-review`)
      .set('Authorization', `Bearer ${authorSession}`)
      .send({ expectedVersion: version });
    version = res.body.version;

    res = await request(app.getHttpServer())
      .post(`/v1/articles/${concurrentArticleId}/start-review`)
      .set('Authorization', `Bearer ${editorSession}`)
      .send({ expectedVersion: version });
    version = res.body.version;

    res = await request(app.getHttpServer())
      .post(`/v1/articles/${concurrentArticleId}/approve`)
      .set('Authorization', `Bearer ${editorSession}`)
      .send({ expectedVersion: version });
    version = res.body.version;

    const futureDate = new Date();
    futureDate.setMinutes(futureDate.getMinutes() + 10);

    const [scheduleRes, deleteRes] = await Promise.all([
      request(app.getHttpServer())
        .post(`/v1/articles/${concurrentArticleId}/schedule`)
        .set('Authorization', `Bearer ${editorSession}`)
        .send({ expectedVersion: version, scheduledFor: futureDate.toISOString() }),
      request(app.getHttpServer())
        .delete(`/v1/articles/${concurrentArticleId}`)
        .set('Authorization', `Bearer ${authorSession}`),
    ]);

    const article = await prisma.article.findUnique({ where: { id: concurrentArticleId } });
    const pendingSchedules = await prisma.publicationSchedule.findMany({
      where: { articleId: concurrentArticleId, status: 'PENDING' },
    });

    if (scheduleRes.status === 201) {
      // Scheduling acquired the row lock first: deletion must be rejected.
      expect(deleteRes.status).toBe(409);
      expect(article?.deletedAt).toBeNull();
      expect(article?.status).toBe('SCHEDULED');
      expect(pendingSchedules).toHaveLength(1);
    } else {
      // Deletion acquired the row lock first: scheduling must fail and leave
      // no executable intent behind.
      expect(deleteRes.status).toBe(200);
      expect(article?.deletedAt).not.toBeNull();
      expect(pendingSchedules).toHaveLength(0);
    }

    // Keep cross-suite cleanup deterministic regardless of which side won.
    await prisma.publicationSchedule.deleteMany({ where: { articleId: concurrentArticleId } });
    await prisma.article.deleteMany({ where: { id: concurrentArticleId } });
  });

  it('9. A committed schedule survives an enqueue failure and the endpoint reports the committed state', async () => {
    let res = await request(app.getHttpServer())
      .post('/v1/articles')
      .set('Authorization', `Bearer ${authorSession}`)
      .send({ title: 'Enqueue Failure Test', body: 'Content' });
    const enqueueArticleId = res.body.id;
    let version = res.body.version;

    res = await request(app.getHttpServer())
      .post(`/v1/articles/${enqueueArticleId}/submit-review`)
      .set('Authorization', `Bearer ${authorSession}`)
      .send({ expectedVersion: version });
    version = res.body.version;

    res = await request(app.getHttpServer())
      .post(`/v1/articles/${enqueueArticleId}/start-review`)
      .set('Authorization', `Bearer ${editorSession}`)
      .send({ expectedVersion: version });
    version = res.body.version;

    res = await request(app.getHttpServer())
      .post(`/v1/articles/${enqueueArticleId}/approve`)
      .set('Authorization', `Bearer ${editorSession}`)
      .send({ expectedVersion: version });
    version = res.body.version;

    const futureDate = new Date();
    futureDate.setMinutes(futureDate.getMinutes() + 10);

    const schedulingService = app.get(SchedulingService);
    const enqueueSpy = jest
      .spyOn(schedulingService, 'enqueuePublishJob')
      .mockRejectedValueOnce(new Error('Redis connection refused'));

    let committedVersion: number;
    try {
      res = await request(app.getHttpServer())
        .post(`/v1/articles/${enqueueArticleId}/schedule`)
        .set('Authorization', `Bearer ${editorSession}`)
        .send({ expectedVersion: version, scheduledFor: futureDate.toISOString() });

      // The database transaction committed before Redis failed: the endpoint
      // must not report an error that implies the schedule rolled back.
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('SCHEDULED');
      committedVersion = res.body.version;
      expect(committedVersion).toBe(version + 1);
    } finally {
      enqueueSpy.mockRestore();
    }

    const persistedSchedule = await prisma.publicationSchedule.findFirst({
      where: { articleId: enqueueArticleId, status: 'PENDING' },
    });
    expect(persistedSchedule).not.toBeNull();
    expect(persistedSchedule?.expectedArticleVersion).toBe(committedVersion!);

    const persistedArticle = await prisma.article.findUnique({
      where: { id: enqueueArticleId },
    });
    expect(persistedArticle?.status).toBe('SCHEDULED');

    // The safety sweep remains responsible for repairing the missing job;
    // this test only proves the committed schedule is authoritative.
    await prisma.publicationSchedule.deleteMany({ where: { articleId: enqueueArticleId } });
    await prisma.article.deleteMany({ where: { id: enqueueArticleId } });
  });
});
