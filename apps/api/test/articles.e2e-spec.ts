
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from './../src/app.module';
import { prisma } from '../src/database/client';

describe('ArticlesCore (e2e)', () => {
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
      }),
    );
    await app.init();

    await prisma.articleRevision.deleteMany();
    await prisma.article.deleteMany();
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

    const authorLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'author_e2e@dailystar.local', password: 'password123' });
    
    if (authorLogin.status !== 200) console.log('AUTHOR LOGIN FAIL:', authorLogin.body);
    authorSession = authorLogin.body.accessToken;

    const editorLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'editor_e2e@dailystar.local', password: 'password123' });
    
    if (editorLogin.status !== 200) console.log('EDITOR LOGIN FAIL:', editorLogin.body);
    editorSession = editorLogin.body.accessToken;

    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin_e2e@dailystar.local', password: 'password123' });
    
    if (adminLogin.status !== 200) console.log('ADMIN LOGIN FAIL:', adminLogin.body);
    adminSession = adminLogin.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  let articleId: string;
  let originalVersion: number;

  it('/v1/articles (POST) - Author creates draft', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/articles')
      .set('Authorization', `Bearer ${authorSession}`)
      .send({
        title: 'E2E Test Article',
        body: 'Initial content',
        tags: ['test']
      });

    expect(res.status).toBe(201);
    expect(res.body.slug).toBe('e2e-test-article');
    expect(res.body.version).toBe(1);
    expect(res.body.currentRevision.title).toBe('E2E Test Article');
    articleId = res.body.id;
    originalVersion = res.body.version;
  });

  it('/v1/articles/:id (PATCH) - Mass-assignment atomicity/security test', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/v1/articles/${articleId}`)
      .set('Authorization', `Bearer ${authorSession}`)
      .send({
        title: 'Legitimate update attempt',
        body: 'Should not save',
        status: 'PUBLISHED',
        primaryAuthorId: 'some-other-uuid',
        expectedVersion: originalVersion
      });

    expect(res.status).toBe(400);
    
    const dbArticle = await prisma.article.findUnique({ where: { id: articleId }, include: { currentRevision: true }});
    expect(dbArticle).not.toBeNull();
    expect(dbArticle!.version).toBe(originalVersion);
    expect(dbArticle!.currentRevision!.title).toBe('E2E Test Article');
  });

  it('/v1/articles/:id (GET) - IDOR prevention (unauthorized user gets 404)', async () => {
    // Register a new temporary author
    const tempRegister = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'temp4@dailystar.local', password: 'password123', displayName: 'Temp4' });
    
    const tempSession = tempRegister.body.accessToken;

    const res = await request(app.getHttpServer())
      .get(`/v1/articles/${articleId}`)
      .set('Authorization', `Bearer ${tempSession}`);

    expect(res.status).toBe(404);
  });

  it('/v1/articles/:id (PATCH) - Optimistic concurrency conflict', async () => {
    const res1 = await request(app.getHttpServer())
      .patch(`/v1/articles/${articleId}`)
      .set('Authorization', `Bearer ${authorSession}`)
      .send({
        title: 'Updated title 1',
        expectedVersion: originalVersion
      });
    expect(res1.status).toBe(200);
    expect(res1.body.version).toBe(originalVersion + 1);

    const res2 = await request(app.getHttpServer())
      .patch(`/v1/articles/${articleId}`)
      .set('Authorization', `Bearer ${authorSession}`)
      .send({
        title: 'Updated title 2',
        expectedVersion: originalVersion
      });
    expect(res2.status).toBe(409);
  });

  let revisionIdToFetch: string;
  it('/v1/articles/:id/revisions/:revisionId (GET) - Single revision retrieval', async () => {
    const listRes = await request(app.getHttpServer())
      .get(`/v1/articles/${articleId}/revisions`)
      .set('Authorization', `Bearer ${authorSession}`);
    
    expect(listRes.status).toBe(200);
    expect(listRes.body.length).toBeGreaterThan(1);
    
    revisionIdToFetch = listRes.body.find((r: any) => r.revisionNumber === 1).id;

    const revRes = await request(app.getHttpServer())
      .get(`/v1/articles/${articleId}/revisions/${revisionIdToFetch}`)
      .set('Authorization', `Bearer ${authorSession}`);

    expect(revRes.status).toBe(200);
    expect(revRes.body.title).toBe('E2E Test Article');
    expect(revRes.body.body).toBe('Initial content');
  });

  it('/v1/articles/:id (DELETE) and (POST restore) - Soft delete and explicit restore', async () => {
    const delRes = await request(app.getHttpServer())
      .delete(`/v1/articles/${articleId}`)
      .set('Authorization', `Bearer ${authorSession}`);
    expect(delRes.status).toBe(200);

    const getRes = await request(app.getHttpServer())
      .get(`/v1/articles/${articleId}`)
      .set('Authorization', `Bearer ${authorSession}`);
    expect(getRes.status).toBe(404);

    const restRes = await request(app.getHttpServer())
      .post(`/v1/articles/${articleId}/restore`)
      .set('Authorization', `Bearer ${authorSession}`);
    expect(restRes.status).toBe(201);

    const getRes2 = await request(app.getHttpServer())
      .get(`/v1/articles/${articleId}`)
      .set('Authorization', `Bearer ${authorSession}`);
    expect(getRes2.status).toBe(200);
  });

  it('/v1/articles/:id (DELETE) - Editor cannot delete another author draft, Admin can', async () => {
    const editorDel = await request(app.getHttpServer())
      .delete(`/v1/articles/${articleId}`)
      .set('Authorization', `Bearer ${editorSession}`);
    expect([403, 404]).toContain(editorDel.status);

    const adminDel = await request(app.getHttpServer())
      .delete(`/v1/articles/${articleId}`)
      .set('Authorization', `Bearer ${adminSession}`);
    expect(adminDel.status).toBe(200);
  });
});
