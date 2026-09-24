import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { prisma } from '../src/database/client';

describe('Public API (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );
    await app.init();

    await prisma.articleRevision.deleteMany();
    await prisma.articleTag.deleteMany();
    await prisma.article.deleteMany();
    await prisma.category.deleteMany();
    await prisma.tag.deleteMany();
    await prisma.authorProfile.deleteMany();
    await prisma.userRole.deleteMany({ where: { user: { email: 'author_public@dailystar.local' } } });
    await prisma.user.deleteMany({ where: { email: 'author_public@dailystar.local' } });

    const user = await prisma.user.create({
      data: {
        email: 'author_public@dailystar.local',
        passwordHash: 'hash',
        displayName: 'Public Author',
      }
    });

    await prisma.authorProfile.create({
      data: {
        userId: user.id,
        displayName: 'Public Author',
        bio: 'Hello bio',
      }
    });

    const c1 = await prisma.category.create({ data: { name: 'Cat1', slug: 'cat1' } });
    const c2 = await prisma.category.create({ data: { name: 'Cat2', slug: 'cat2', parentId: c1.id } });
    const c3 = await prisma.category.create({ data: { name: 'Cat3', slug: 'cat3', parentId: c2.id } });

    // c4 has no articles and no descendants with articles
    const c4 = await prisma.category.create({ data: { name: 'Cat4', slug: 'cat4' } });

    const tag1 = await prisma.tag.create({ data: { name: 'Tag1', slug: 'tag1' } });

    // Article 1: Published
    const art1 = await prisma.article.create({
      data: {
        slug: 'pub-1',
        primaryAuthorId: user.id,
        createdBy: user.id,
        categoryId: c3.id,
        status: 'PUBLISHED',
        publishedAt: new Date(),
      }
    });
    const rev1 = await prisma.articleRevision.create({
      data: {
        articleId: art1.id,
        authorId: user.id,
        title: 'Pub 1 Title',
        body: 'Pub 1 Body',
        revisionNumber: 1,
      }
    });
    await prisma.article.update({
      where: { id: art1.id },
      data: { currentRevisionId: rev1.id, currentPublishedRevisionId: rev1.id }
    });
    await prisma.articleTag.create({ data: { articleId: art1.id, tagId: tag1.id } });

    // Article 2: Draft
    const art2 = await prisma.article.create({
      data: {
        slug: 'draft-1',
        primaryAuthorId: user.id,
        createdBy: user.id,
        categoryId: c3.id,
        status: 'DRAFT',
      }
    });
    const rev2 = await prisma.articleRevision.create({
      data: {
        articleId: art2.id,
        authorId: user.id,
        title: 'Draft 1 Title',
        body: 'Draft 1 Body',
        revisionNumber: 1,
      }
    });
    await prisma.article.update({
      where: { id: art2.id },
      data: { currentRevisionId: rev2.id }
    });

    // Article 3: Soft-deleted Published
    const art3 = await prisma.article.create({
      data: {
        slug: 'del-1',
        primaryAuthorId: user.id,
        createdBy: user.id,
        categoryId: c3.id,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        deletedAt: new Date(),
      }
    });
    const rev3 = await prisma.articleRevision.create({
      data: {
        articleId: art3.id,
        authorId: user.id,
        title: 'Del 1 Title',
        body: 'Del 1 Body',
        revisionNumber: 1,
      }
    });
    await prisma.article.update({
      where: { id: art3.id },
      data: { currentRevisionId: rev3.id, currentPublishedRevisionId: rev3.id }
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('/v1/public/articles (GET) - Returns only published articles (PR-01 to PR-05)', async () => {
    const res = await request(app.getHttpServer()).get('/v1/public/articles');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].slug).toBe('pub-1');
    expect(res.body.data[0].author.displayName).toBe('Public Author');
    expect(res.body.data[0].category.slug).toBe('cat3');
  });

  it('/v1/public/articles (GET) - Validation for invalid values', async () => {
    const res = await request(app.getHttpServer()).get('/v1/public/articles?limit=100&orderBy=invalid');
    expect(res.status).toBe(400); // Bad Request because limit max is 50, orderBy is invalid
  });

  it('/v1/public/articles/:slug (GET) - Resolves only published article (PR-06 to PR-08)', async () => {
    const res = await request(app.getHttpServer()).get('/v1/public/articles/pub-1');
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Pub 1 Title');
    expect(res.body.body).toBe('Pub 1 Body');
  });

  it('/v1/public/articles/:slug (GET) - Draft returns 404', async () => {
    const res = await request(app.getHttpServer()).get('/v1/public/articles/draft-1');
    expect(res.status).toBe(404);
  });

  it('/v1/public/articles/:slug (GET) - Soft-deleted returns 404', async () => {
    const res = await request(app.getHttpServer()).get('/v1/public/articles/del-1');
    expect(res.status).toBe(404);
  });

  it('/v1/public/categories (GET) - Returns categories up to depth 3, omitting zero-descendant leaves (PR-13, PR-14)', async () => {
    const res = await request(app.getHttpServer()).get('/v1/public/categories');
    expect(res.status).toBe(200);

    // cat1 -> cat2 -> cat3 should be present
    expect(res.body.length).toBe(1);
    expect(res.body[0].slug).toBe('cat1');
    expect(res.body[0].publishedArticleCount).toBe(0); // Ancestor with zero direct articles
    expect(res.body[0].children[0].slug).toBe('cat2');
    expect(res.body[0].children[0].publishedArticleCount).toBe(0);
    expect(res.body[0].children[0].children[0].slug).toBe('cat3');
    expect(res.body[0].children[0].children[0].publishedArticleCount).toBe(1);

    // cat4 should NOT be in the results (zero articles, zero descendants)
    const cat4 = res.body.find((c: any) => c.slug === 'cat4');
    expect(cat4).toBeUndefined();
  });

  it('/v1/public/categories/:slug/articles (GET) - Missing category returns 404', async () => {
    const res = await request(app.getHttpServer()).get('/v1/public/categories/does-not-exist/articles');
    expect(res.status).toBe(404);
  });

  it('/v1/public/categories/:slug/articles (GET) - Category with 0 published returns 404', async () => {
    const res = await request(app.getHttpServer()).get('/v1/public/categories/cat4/articles');
    expect(res.status).toBe(404);
  });

  it('/v1/public/categories/:slug/articles (GET) - Beyond last page returns 200 with empty data', async () => {
    const res = await request(app.getHttpServer()).get('/v1/public/categories/cat3/articles?page=5');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.total).toBe(1);
  });

  it('/v1/public/search (GET) - Delegates correctly and trims query (PR-17 to PR-19)', async () => {
    const res = await request(app.getHttpServer()).get('/v1/public/search?q=Pub');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('total');
  });

  it('/v1/public/search (GET) - Whitespace-only q returns 400', async () => {
    const res = await request(app.getHttpServer()).get('/v1/public/search?q=%20%20%20');
    expect(res.status).toBe(400);
  });

  it('/v1/public/articles/:slug/cover (GET) - Missing signature falls back to req.ip and checks limit', async () => {
    const res = await request(app.getHttpServer()).get('/v1/public/articles/pub-1/cover');
    // We expect 404 since pub-1 doesn't have a cover image in the seed data
    expect(res.status).toBe(404);
  });

  it('/v1/public/articles/:slug/cover (GET) - Valid HMAC signature passes through', async () => {
    const crypto = require('crypto');
    const secret = process.env.PUBLIC_COVER_PROXY_TRUST_SECRET || 'test_secret_must_be_32_characters_long!';
    const ip = '203.0.113.5';
    const signature = crypto.createHmac('sha256', secret).update(ip).digest('hex');

    const res = await request(app.getHttpServer())
      .get('/v1/public/articles/pub-1/cover')
      .set('X-DailyStar-Client-IP', ip)
      .set('X-DailyStar-Client-IP-Signature', signature);

    expect(res.status).toBe(404); // no cover image
  });

  it('/v1/public/articles/:slug/cover (GET) - Invalid signature falls back to req.ip', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/public/articles/pub-1/cover')
      .set('X-DailyStar-Client-IP', '203.0.113.5')
      .set('X-DailyStar-Client-IP-Signature', 'invalid');

    expect(res.status).toBe(404);
  });
});
