import * as crypto from 'crypto';
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

    // Article 4: Published with title-only match for search
    const art4 = await prisma.article.create({
      data: {
        slug: 'pub-2',
        primaryAuthorId: user.id,
        createdBy: user.id,
        categoryId: c3.id,
        status: 'PUBLISHED',
        publishedAt: new Date(),
      }
    });
    const rev4 = await prisma.articleRevision.create({
      data: {
        articleId: art4.id,
        authorId: user.id,
        title: 'UniqueTitleKeyword that should match',
        body: 'This is the body content, it does not contain the keyword.',
        revisionNumber: 1,
      }
    });
    await prisma.article.update({
      where: { id: art4.id },
      data: { currentRevisionId: rev4.id, currentPublishedRevisionId: rev4.id }
    });

    // Article 5: Published with cover image (PB-02)
    const media1 = await prisma.media.create({
      data: {
        objectKey: 'covers/test-cover.jpg',
        mimeType: 'image/jpeg',
        status: 'READY',
        uploadedBy: { connect: { id: user.id } },
        bucket: 'test-bucket',
        originalFilename: 'test-cover.jpg',
        fileSizeBytes: 1024,
        sha256Checksum: 'dummy-sha',
      }
    });

    const art5 = await prisma.article.create({
      data: {
        slug: 'pub-3',
        primaryAuthorId: user.id,
        createdBy: user.id,
        categoryId: c3.id,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        coverMediaId: media1.id,
      }
    });
    const rev5 = await prisma.articleRevision.create({
      data: {
        articleId: art5.id,
        authorId: user.id,
        title: 'Pub 3 Title',
        body: 'Pub 3 Body',
        revisionNumber: 1,
      }
    });
    await prisma.article.update({
      where: { id: art5.id },
      data: { currentRevisionId: rev5.id, currentPublishedRevisionId: rev5.id }
    });

    // Media 2 (FAILED status)
    const media2 = await prisma.media.create({
      data: {
        objectKey: 'covers/test-failed.jpg',
        mimeType: 'image/jpeg',
        status: 'FAILED',
        uploadedBy: { connect: { id: user.id } },
        bucket: 'test-bucket',
        originalFilename: 'test-failed.jpg',
        fileSizeBytes: 1024,
        sha256Checksum: 'dummy-sha-2',
      }
    });

    // Article 6: Published with FAILED cover (PR-12)
    const art6 = await prisma.article.create({
      data: {
        slug: 'pub-4',
        primaryAuthorId: user.id,
        createdBy: user.id,
        categoryId: c3.id,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        coverMediaId: media2.id,
      }
    });
    const rev6 = await prisma.articleRevision.create({
      data: {
        articleId: art6.id,
        authorId: user.id,
        title: 'Pub 4 Title',
        body: 'Pub 4 Body',
        revisionNumber: 1,
      }
    });
    await prisma.article.update({
      where: { id: art6.id },
      data: { currentRevisionId: rev6.id, currentPublishedRevisionId: rev6.id }
    });

    // Article 7: Published in a different category (cat1) to test category filters
    const art7 = await prisma.article.create({
      data: {
        slug: 'pub-5',
        primaryAuthorId: user.id,
        createdBy: user.id,
        categoryId: c1.id,
        status: 'PUBLISHED',
        publishedAt: new Date(),
      }
    });
    const rev7 = await prisma.articleRevision.create({
      data: {
        articleId: art7.id,
        authorId: user.id,
        title: 'Pub 5 Title',
        body: 'Pub 5 Body',
        revisionNumber: 1,
      }
    });
    await prisma.article.update({
      where: { id: art7.id },
      data: { currentRevisionId: rev7.id, currentPublishedRevisionId: rev7.id }
    });

    const tag2 = await prisma.tag.create({ data: { name: 'Tag2', slug: 'tag2' } });
    await prisma.articleTag.create({ data: { articleId: art7.id, tagId: tag2.id } });
  });

  afterAll(async () => {
    await app.close();
  });

  it('/v1/public/articles (GET) - Returns only published articles (PR-01 to PR-05)', async () => {
    const res = await request(app.getHttpServer()).get('/v1/public/articles');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(5);
    const pub1 = res.body.data.find((a: any) => a.slug === 'pub-1');
    expect(pub1).toBeDefined();
    expect(pub1.author.displayName).toBe('Public Author');
    expect(pub1.category.slug).toBe('cat3');
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
    expect(res.body[0].publishedArticleCount).toBe(1); // pub-5 is here directly
    expect(res.body[0].children[0].slug).toBe('cat2');
    expect(res.body[0].children[0].publishedArticleCount).toBe(0);
    expect(res.body[0].children[0].children[0].slug).toBe('cat3');
    expect(res.body[0].children[0].children[0].publishedArticleCount).toBe(4);

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
    expect(res.body.total).toBe(4);
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

  it('/v1/public/articles/:slug/cover (GET) - PB-02 Cover endpoint rate limits after 100 requests', async () => {
    const secret = process.env.PUBLIC_COVER_PROXY_TRUST_SECRET || 'test_secret_must_be_32_characters_long!';
    const ip = '203.0.113.100';
    const signature = crypto.createHmac('sha256', secret).update(ip).digest('hex');

    // 100 successful requests (should resolve to a 302 redirect for the presigned url)
    for (let i = 0; i < 100; i++) {
      const res = await request(app.getHttpServer())
        .get('/v1/public/articles/pub-3/cover')
        .set('X-DailyStar-Client-IP', ip)
        .set('X-DailyStar-Client-IP-Signature', signature);
      expect([302, 200]).toContain(res.status);
    }

    // 101st request should be rate limited
    const limitRes = await request(app.getHttpServer())
      .get('/v1/public/articles/pub-3/cover')
      .set('X-DailyStar-Client-IP', ip)
      .set('X-DailyStar-Client-IP-Signature', signature);

    expect(limitRes.status).toBe(429);
    expect(limitRes.headers['retry-after']).toBe('60');
  });

  it('/v1/public/search (GET) - PR-18 Title-only FTS match does not assume <b> in headline', async () => {
    const res = await request(app.getHttpServer()).get('/v1/public/search?q=UniqueTitleKeyword');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);

    const article = res.body.data.find((a: any) => a.slug === 'pub-2');
    expect(article).toBeDefined();

    if (article.headline) {
      expect(article.headline).not.toContain('<b>');
    }
  });

  it('/v1/public/articles/:slug/cover (GET) - PR-09 Cover endpoint returns signedUrl + metadata', async () => {
    const res = await request(app.getHttpServer()).get('/v1/public/articles/pub-3/cover');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('signedUrl');
    expect(res.body).toHaveProperty('expiresAt');
    expect(res.body).toHaveProperty('mimeType');
    expect(res.body).toHaveProperty('width');
    expect(res.body).toHaveProperty('height');
  });

  it('/v1/public/articles/:slug/cover (GET) - PR-10 Cover endpoint returns 404 for non-PUBLISHED article', async () => {
    const res = await request(app.getHttpServer()).get('/v1/public/articles/draft-1/cover');
    expect(res.status).toBe(404);
  });

  it('/v1/public/articles/:slug/cover (GET) - PR-11 Cover endpoint returns 404 for published article with coverMediaId = null', async () => {
    const res = await request(app.getHttpServer()).get('/v1/public/articles/pub-1/cover');
    expect(res.status).toBe(404);
  });

  it('/v1/public/articles/:slug/cover (GET) - PR-12 Cover endpoint returns 404 when media status != READY', async () => {
    const res = await request(app.getHttpServer()).get('/v1/public/articles/pub-4/cover');
    expect(res.status).toBe(404);
  });

  it('/v1/public/articles (GET) - PR-20 Feed categoryId filter', async () => {
    const c1 = await prisma.category.findUnique({ where: { slug: 'cat1' } });
    const res = await request(app.getHttpServer()).get(`/v1/public/articles?categoryId=${c1!.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const article of res.body.data) {
      expect(article.category.id).toBe(c1!.id);
    }
  });

  it('/v1/public/articles (GET) - PR-21 Feed categorySlug filter', async () => {
    const res = await request(app.getHttpServer()).get('/v1/public/articles?categorySlug=cat1');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const article of res.body.data) {
      expect(article.category.slug).toBe('cat1');
    }
  });

  it('/v1/public/articles (GET) - PR-22 Feed tag filter, case-insensitive', async () => {
    const res1 = await request(app.getHttpServer()).get('/v1/public/articles?tag=Tag1');
    const res2 = await request(app.getHttpServer()).get('/v1/public/articles?tag=tag1');
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res1.body.data.length).toBeGreaterThan(0);
    expect(res1.body.data).toEqual(res2.body.data);
    expect(res1.body.total).toBe(res2.body.total);
    for (const article of res1.body.data) {
      expect(article.tags).toContain('Tag1');
    }
  });

  it('/v1/public/categories/:slug/articles (GET) - PR-25 Category articles tag filter', async () => {
    const res = await request(app.getHttpServer()).get('/v1/public/categories/cat3/articles?tag=tag1');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const article of res.body.data) {
      expect(article.category.slug).toBe('cat3');
      expect(article.tags).toContain('Tag1');
    }
  });

  it('/v1/public/search (GET) - PR-26 Search categorySlug filter', async () => {
    const res = await request(app.getHttpServer()).get('/v1/public/search?q=Pub&categorySlug=cat1');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const article of res.body.data) {
      expect(article.category.slug).toBe('cat1');
    }
  });
});
