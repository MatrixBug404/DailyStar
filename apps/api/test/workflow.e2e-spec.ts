import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from './../src/app.module';
import { prisma } from '../src/database/client';

describe('Workflow & Concurrency E2E (Phase 3)', () => {
  jest.setTimeout(30000);
  let app: INestApplication;
  let authorSession: string;
  let editorSession: string;
  let adminSession: string;

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

    await prisma.auditLog.deleteMany();
    await prisma.articleRevision.deleteMany();
    await prisma.article.deleteMany();
    
    // Clear user roles and users
    await prisma.userRole.deleteMany({
      where: { user: { email: { in: ['author_e2e@dailystar.local', 'editor_e2e@dailystar.local', 'admin_e2e@dailystar.local', 'temp4@dailystar.local'] } } }
    });
    await prisma.user.deleteMany({
      where: { email: { in: ['author_e2e@dailystar.local', 'editor_e2e@dailystar.local', 'admin_e2e@dailystar.local', 'temp4@dailystar.local'] } }
    });

    await request(app.getHttpServer()).post('/auth/register').send({ email: 'author_e2e@dailystar.local', password: 'password123', displayName: 'Author' });
    
    await request(app.getHttpServer()).post('/auth/register').send({ email: 'editor_e2e@dailystar.local', password: 'password123', displayName: 'Editor' });
    const editorUser = await prisma.user.findUnique({ where: { email: 'editor_e2e@dailystar.local' }});
    await prisma.userRole.deleteMany({ where: { userId: editorUser!.id }});
    await prisma.userRole.create({ data: { userId: editorUser!.id, roleId: (await prisma.role.findUnique({where:{name:'editor'}}))!.id } });

    await request(app.getHttpServer()).post('/auth/register').send({ email: 'admin_e2e@dailystar.local', password: 'password123', displayName: 'Admin' });
    const adminUser = await prisma.user.findUnique({ where: { email: 'admin_e2e@dailystar.local' }});
    await prisma.userRole.deleteMany({ where: { userId: adminUser!.id }});
    await prisma.userRole.create({ data: { userId: adminUser!.id, roleId: (await prisma.role.findUnique({where:{name:'admin'}}))!.id } });

    const authorLogin = await request(app.getHttpServer()).post('/auth/login').send({ email: 'author_e2e@dailystar.local', password: 'password123' });
    authorSession = authorLogin.body.accessToken;

    const editorLogin = await request(app.getHttpServer()).post('/auth/login').send({ email: 'editor_e2e@dailystar.local', password: 'password123' });
    editorSession = editorLogin.body.accessToken;

    const adminLogin = await request(app.getHttpServer()).post('/auth/login').send({ email: 'admin_e2e@dailystar.local', password: 'password123' });
    adminSession = adminLogin.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  let articleId: string;
  let currentVersion: number;

  it('1. Create draft article', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/articles')
      .set('Authorization', `Bearer ${authorSession}`)
      .send({
        title: 'Workflow Test Article',
        body: 'Initial content',
        tags: ['test']
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('DRAFT');
    articleId = res.body.id;
    currentVersion = res.body.version;
  });

  it('2. DRAFT -> SUBMITTED_FOR_REVIEW', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/articles/${articleId}/submit-review`)
      .set('Authorization', `Bearer ${authorSession}`)
      .send({ expectedVersion: currentVersion });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('SUBMITTED_FOR_REVIEW');
    currentVersion = res.body.version;
  });

  it('3. Author cannot start review', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/articles/${articleId}/start-review`)
      .set('Authorization', `Bearer ${authorSession}`)
      .send({ expectedVersion: currentVersion });
    
    expect(res.status).toBe(403);
  });

  it('4. SUBMITTED_FOR_REVIEW -> UNDER_REVIEW (Editor)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/articles/${articleId}/start-review`)
      .set('Authorization', `Bearer ${editorSession}`)
      .send({ expectedVersion: currentVersion });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('UNDER_REVIEW');
    currentVersion = res.body.version;
  });

  it('5. UNDER_REVIEW -> DRAFT via request-changes', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/articles/${articleId}/request-changes`)
      .set('Authorization', `Bearer ${editorSession}`)
      .send({ expectedVersion: currentVersion, comment: 'Needs more sources' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('DRAFT');
    currentVersion = res.body.version;
  });

  it('6. Author edits and resubmits', async () => {
    const patchRes = await request(app.getHttpServer())
      .patch(`/v1/articles/${articleId}`)
      .set('Authorization', `Bearer ${authorSession}`)
      .send({ body: 'Updated content with sources', expectedVersion: currentVersion });
    expect(patchRes.status).toBe(200);
    currentVersion = patchRes.body.version;

    const res = await request(app.getHttpServer())
      .post(`/v1/articles/${articleId}/submit-review`)
      .set('Authorization', `Bearer ${authorSession}`)
      .send({ expectedVersion: currentVersion });
    expect(res.status).toBe(201);
    currentVersion = res.body.version;
  });

  it('7. Editor starts review and rejects (DRAFT)', async () => {
    let res = await request(app.getHttpServer())
      .post(`/v1/articles/${articleId}/start-review`)
      .set('Authorization', `Bearer ${editorSession}`)
      .send({ expectedVersion: currentVersion });
    expect(res.status).toBe(201);
    currentVersion = res.body.version;

    res = await request(app.getHttpServer())
      .post(`/v1/articles/${articleId}/reject`)
      .set('Authorization', `Bearer ${editorSession}`)
      .send({ expectedVersion: currentVersion, comment: 'Not suitable' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('DRAFT');
    currentVersion = res.body.version;
  });

  it('8. Resubmit, review, and APPROVE', async () => {
    let res = await request(app.getHttpServer())
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
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('APPROVED');
    expect(res.body.approvedRevisionId).not.toBeNull();
    currentVersion = res.body.version;
  });

  it('9. Concurrency checks on approve', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/articles/${articleId}/approve`)
      .set('Authorization', `Bearer ${editorSession}`)
      .send({ expectedVersion: 999999 }); // Stale version
    expect(res.status).toBe(409); // VERSION_MISMATCH

    const res2 = await request(app.getHttpServer())
      .post(`/v1/articles/${articleId}/approve`)
      .set('Authorization', `Bearer ${editorSession}`)
      .send({}); // Missing expectedVersion
    expect(res2.status).toBe(400); // VERSION_REQUIRED
  });

  it('10. Edit APPROVED -> creates new revision, atomically reverts to DRAFT, clears approved/scheduled', async () => {
    const patchRes = await request(app.getHttpServer())
      .patch(`/v1/articles/${articleId}`)
      .set('Authorization', `Bearer ${authorSession}`)
      .send({ body: 'Changing after approval', expectedVersion: currentVersion });
    
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.status).toBe('DRAFT');
    expect(patchRes.body.approvedRevisionId).toBeNull();
    currentVersion = patchRes.body.version;
  });

  it('11. Resubmit -> Review -> Approve', async () => {
    let res = await request(app.getHttpServer())
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
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('APPROVED');
    currentVersion = res.body.version;
  });

  it('12. Schedule -> Cancel -> Publish -> Archive', async () => {
    // Schedule
    const futureDate = new Date();
    futureDate.setMinutes(futureDate.getMinutes() + 10);

    let res = await request(app.getHttpServer())
      .post(`/v1/articles/${articleId}/schedule`)
      .set('Authorization', `Bearer ${editorSession}`)
      .send({ expectedVersion: currentVersion, scheduledFor: futureDate.toISOString() });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('SCHEDULED');
    currentVersion = res.body.version;

    // Cancel Schedule
    res = await request(app.getHttpServer())
      .post(`/v1/articles/${articleId}/cancel-schedule`)
      .set('Authorization', `Bearer ${editorSession}`)
      .send({ expectedVersion: currentVersion });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('APPROVED');
    currentVersion = res.body.version;

    // Publish
    res = await request(app.getHttpServer())
      .post(`/v1/articles/${articleId}/publish`)
      .set('Authorization', `Bearer ${editorSession}`)
      .send({ expectedVersion: currentVersion });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PUBLISHED');
    currentVersion = res.body.version;

    // Archive
    res = await request(app.getHttpServer())
      .post(`/v1/articles/${articleId}/archive`)
      .set('Authorization', `Bearer ${editorSession}`)
      .send({ expectedVersion: currentVersion });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('ARCHIVED');
    currentVersion = res.body.version;

    // ARCHIVED is terminal
    res = await request(app.getHttpServer())
      .post(`/v1/articles/${articleId}/publish`)
      .set('Authorization', `Bearer ${editorSession}`)
      .send({ expectedVersion: currentVersion });
    expect(res.status).toBe(400); // Invalid transition
  });

  it('13. Soft delete -> endpoints return 404', async () => {
    await request(app.getHttpServer())
      .delete(`/v1/articles/${articleId}`)
      .set('Authorization', `Bearer ${adminSession}`);

    const res = await request(app.getHttpServer())
      .post(`/v1/articles/${articleId}/archive`)
      .set('Authorization', `Bearer ${editorSession}`)
      .send({ expectedVersion: currentVersion });
    
    expect(res.status).toBe(404);
  });

  it('14. Audit records check & IDOR', async () => {
    // Author -> 403
    const resAuth = await request(app.getHttpServer())
      .get(`/v1/articles/${articleId}/audit`)
      .set('Authorization', `Bearer ${authorSession}`);
    expect(resAuth.status).toBe(403);

    // Editor -> 404 (because it's soft deleted!)
    let resEd = await request(app.getHttpServer())
      .get(`/v1/articles/${articleId}/audit`)
      .set('Authorization', `Bearer ${editorSession}`);
    expect(resEd.status).toBe(404);

    // Restore it
    await request(app.getHttpServer())
      .post(`/v1/articles/${articleId}/restore`)
      .set('Authorization', `Bearer ${adminSession}`);

    // Editor -> 200
    resEd = await request(app.getHttpServer())
      .get(`/v1/articles/${articleId}/audit`)
      .set('Authorization', `Bearer ${editorSession}`);
    expect(resEd.status).toBe(200);
    expect(Array.isArray(resEd.body)).toBe(true);
    
    // Check auto-revert audit
    const revertAudit = resEd.body.find((a: any) => a.action === 'ARTICLE_RESET_TO_DRAFT');
    expect(revertAudit).toBeDefined();
    
    // Ensure no sensitive data in metadata or before/after state
    const strBody = JSON.stringify(resEd.body);
    expect(strBody).not.toContain('passwordHash');
    expect(strBody).not.toContain('token');
  });
});
