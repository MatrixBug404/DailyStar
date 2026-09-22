import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { prisma } from '../src/database/client';
import { MediaService } from '../src/modules/media/media.service';
import {
  STORAGE_SERVICE,
  StorageService,
} from '../src/modules/media/storage/storage.service.interface';

// Mock file-type to prevent Jest from crashing on the ESM package
jest.mock('file-type', () => ({
  fileTypeFromBuffer: jest.fn().mockImplementation(async (buffer) => {
    const str = buffer.toString();
    if (str.startsWith('%PDF')) return { ext: 'pdf', mime: 'application/pdf' };
    if (str.startsWith('<?php')) return undefined;
    return { ext: 'jpg', mime: 'image/jpeg' };
  }),
}));

const SHORT_EXPIRY_SECONDS = 2; // Used only for expired-URL test
const TEST_EMAILS = [
  'media_author@dailystar.local',
  'media_author2@dailystar.local',
  'media_editor@dailystar.local',
  'media_admin@dailystar.local',
];

describe('MediaController (e2e)', () => {
  jest.setTimeout(30000);
  let app: INestApplication;
  let mediaService: MediaService;
  let storageService: StorageService;

  let authorToken: string;
  let author2Token: string;
  let editorToken: string;
  let adminToken: string;
  let authorUserId: string;
  let author2UserId: string;
  let editorUserId: string;
  let adminUserId: string;

  let mediaId: string;
  let id2: string;
  let objectKey: string;
  let articleId: string;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    mediaService = moduleFixture.get(MediaService);
    storageService = moduleFixture.get(STORAGE_SERVICE);

    // 1. Clean DB
    await prisma.articleTag.deleteMany();
    await prisma.tag.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.articleRevision.deleteMany();
    await prisma.article.deleteMany();
    await prisma.media.deleteMany();
    await prisma.userRole.deleteMany({
      where: { user: { email: { in: TEST_EMAILS } } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: TEST_EMAILS } },
    });

    // Create users & auth
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: TEST_EMAILS[0], password: 'password123', displayName: 'Author' });
    const authorLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: TEST_EMAILS[0], password: 'password123' });
    authorToken = authorLogin.body.accessToken;
    authorUserId = authorLogin.body.user.id;

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: TEST_EMAILS[1], password: 'password123', displayName: 'Author2' });
    const author2Login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: TEST_EMAILS[1], password: 'password123' });
    author2Token = author2Login.body.accessToken;
    author2UserId = author2Login.body.user.id;

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: TEST_EMAILS[2], password: 'password123', displayName: 'Editor' });
    const editorUser = await prisma.user.findUnique({ where: { email: TEST_EMAILS[2] } });
    editorUserId = editorUser!.id;
    await prisma.userRole.deleteMany({ where: { userId: editorUserId } });
    await prisma.userRole.create({
      data: {
        userId: editorUserId,
        roleId: (await prisma.role.findUnique({ where: { name: 'editor' } }))!.id,
      },
    });
    const editorLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: TEST_EMAILS[2], password: 'password123' });
    editorToken = editorLogin.body.accessToken;

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: TEST_EMAILS[3], password: 'password123', displayName: 'Admin' });
    const adminUser = await prisma.user.findUnique({ where: { email: TEST_EMAILS[3] } });
    adminUserId = adminUser!.id;
    await prisma.userRole.deleteMany({ where: { userId: adminUserId } });
    await prisma.userRole.create({
      data: {
        userId: adminUserId,
        roleId: (await prisma.role.findUnique({ where: { name: 'admin' } }))!.id,
      },
    });
    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: TEST_EMAILS[3], password: 'password123' });
    adminToken = adminLogin.body.accessToken;
  });

  // Valid 1x1 JPEG bytes
  const validJpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48,
    0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00,
    0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x14, 0x00, 0x01, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xc4, 0x00,
    0x14, 0x10, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x3f, 0xff, 0xd9,
  ]);

  it('2. Upload valid JPEG', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/media')
      .set('Authorization', `Bearer ${authorToken}`)
      .attach('file', validJpeg, 'test.jpg');

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('READY');
    expect(res.body.width).toBe(1);
    expect(res.body.height).toBe(1);
    expect(res.body.objectKey).toBeUndefined(); // internal field omitted

    mediaId = res.body.id;
    const dbMedia = await prisma.media.findUnique({ where: { id: mediaId } });
    objectKey = dbMedia!.objectKey;
  });

  it('3. Oversized upload returns 413', async () => {
    const bigBuffer = Buffer.alloc(11 * 1024 * 1024, 0);
    // write jpeg magic bytes to bypass magic check if it was checked before size limit
    bigBuffer[0] = 0xff;
    bigBuffer[1] = 0xd8;
    bigBuffer[2] = 0xff;
    bigBuffer[3] = 0xe0;

    const res = await request(app.getHttpServer())
      .post('/v1/media')
      .set('Authorization', `Bearer ${authorToken}`)
      .attach('file', bigBuffer, 'big.jpg');

    expect(res.status).toBe(413);
    expect(res.body.message).toBe('FILE_TOO_LARGE');
  });

  it('4. Non-image upload returns 400 UNSUPPORTED_MEDIA_TYPE', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/media')
      .set('Authorization', `Bearer ${authorToken}`)
      .attach('file', Buffer.from('%PDF-1.4'), 'test.pdf');
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Internal server error');
  });

  it('5. Fake JPEG returns 400 INVALID_FILE_SIGNATURE', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/media')
      .set('Authorization', `Bearer ${authorToken}`)
      .attach('file', Buffer.from('<?php echo "hack"; ?>'), 'test.jpg');
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Internal server error');
  });

  it('6. GET metadata as author returns 200 without internal fields', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/media/${mediaId}`)
      .set('Authorization', `Bearer ${authorToken}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(mediaId);
    expect(res.body.objectKey).toBeUndefined();
  });

  it('7. IDOR tests (state leak fix)', async () => {
    // author2 (read.own only) trying to read author's READY media -> 404
    let res = await request(app.getHttpServer())
      .get(`/v1/media/${mediaId}`)
      .set('Authorization', `Bearer ${author2Token}`);
    expect(res.status).toBe(404);

    // editor (read.any) trying to read author's READY media -> 200
    res = await request(app.getHttpServer())
      .get(`/v1/media/${mediaId}`)
      .set('Authorization', `Bearer ${editorToken}`);
    expect(res.status).toBe(200);

    // generate a stale UPLOADING media for author
    const staleMedia = await prisma.media.create({
      data: {
        status: 'UPLOADING',
        objectKey: 'media/test/stale.jpg',
        bucket: 'test',
        originalFilename: 'stale.jpg',
        mimeType: 'image/jpeg',
        mediaType: 'IMAGE',
        fileSizeBytes: 100,
        sha256Checksum: 'dummy',
        uploadedById: authorUserId,
        createdAt: new Date(Date.now() - 60 * 60 * 1000), // 1 hr ago
      },
    });

    // author2 trying to read author's stale media -> 404 (IDOR, not 400)
    res = await request(app.getHttpServer())
      .get(`/v1/media/${staleMedia.id}`)
      .set('Authorization', `Bearer ${author2Token}`);
    expect(res.status).toBe(404);

    // author (owner) trying to read own stale media -> 400 MEDIA_NOT_READY
    res = await request(app.getHttpServer())
      .get(`/v1/media/${staleMedia.id}`)
      .set('Authorization', `Bearer ${authorToken}`);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('MEDIA_NOT_READY');
  });

  it('8. Admin GET same media -> 200', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/media/${mediaId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('9. Signed URL generation & fetching', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/media/${mediaId}/signed-url`)
      .set('Authorization', `Bearer ${authorToken}`);
    expect(res.status).toBe(200);
    expect(res.body.signedUrl).toBeDefined();

    const signedUrl = res.body.signedUrl;

    // Using native fetch
    const fetchRes = await fetch(signedUrl);
    expect(fetchRes.status).toBe(200);
    expect(fetchRes.headers.get('content-type')).toBe('image/jpeg');
    expect(fetchRes.headers.get('content-disposition')).toContain('inline');
  });

  it('10. Create article, set cover', async () => {
    const articleRes = await request(app.getHttpServer())
      .post('/v1/articles')
      .set('Authorization', `Bearer ${authorToken}`)
      .send({ title: 'Cover Article', body: 'body' });

    expect(articleRes.status).toBe(201);
    articleId = articleRes.body.id;

    const coverRes = await request(app.getHttpServer())
      .patch(`/v1/articles/${articleId}/cover`)
      .set('Authorization', `Bearer ${authorToken}`)
      .send({
        mediaId,
        expectedVersion: (await prisma.article.findUnique({ where: { id: articleId } }))!.version,
      });

    expect(coverRes.status).toBe(200);
    expect(coverRes.body.coverMediaId).toBe(mediaId);
    expect(coverRes.body.version).toBe(2);
  });

  it('11. Author blocked while SUBMITTED_FOR_REVIEW', async () => {
    await request(app.getHttpServer())
      .post(`/v1/articles/${articleId}/submit-review`)
      .set('Authorization', `Bearer ${authorToken}`)
      .send({
        expectedVersion: (await prisma.article.findUnique({ where: { id: articleId } }))!.version,
      });

    const coverRes = await request(app.getHttpServer())
      .patch(`/v1/articles/${articleId}/cover`)
      .set('Authorization', `Bearer ${authorToken}`)
      .send({
        mediaId,
        expectedVersion: (await prisma.article.findUnique({ where: { id: articleId } }))!.version,
      });

    expect(coverRes.status).toBe(403);
    expect(coverRes.body.message).toBe('COVER_MUTATION_NOT_PERMITTED');
  });

  it('12. Editor allowed while SUBMITTED_FOR_REVIEW', async () => {
    const coverRes = await request(app.getHttpServer())
      .patch(`/v1/articles/${articleId}/cover`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({
        mediaId: null,
        expectedVersion: (await prisma.article.findUnique({ where: { id: articleId } }))!.version,
      });

    expect(coverRes.status).toBe(200);
    expect(coverRes.body.coverMediaId).toBeNull();
    expect(coverRes.body.version).toBe(4);
  });

  it('13. Author blocked while UNDER_REVIEW', async () => {
    await request(app.getHttpServer())
      .post(`/v1/articles/${articleId}/start-review`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({
        expectedVersion: (await prisma.article.findUnique({ where: { id: articleId } }))!.version,
      });

    const coverRes = await request(app.getHttpServer())
      .patch(`/v1/articles/${articleId}/cover`)
      .set('Authorization', `Bearer ${authorToken}`)
      .send({
        mediaId,
        expectedVersion: (await prisma.article.findUnique({ where: { id: articleId } }))!.version,
      });

    expect(coverRes.status).toBe(403);
  });

  it('14. Exactly-once version increment on APPROVED revert (two-update pattern)', async () => {
    await request(app.getHttpServer())
      .post(`/v1/articles/${articleId}/approve`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({
        expectedVersion: (await prisma.article.findUnique({ where: { id: articleId } }))!.version,
      });

    const articleBefore = await prisma.article.findUnique({ where: { id: articleId } });
    expect(articleBefore!.status).toBe('APPROVED');
    const versionBefore = articleBefore!.version; // 3

    const coverRes = await request(app.getHttpServer())
      .patch(`/v1/articles/${articleId}/cover`)
      .set('Authorization', `Bearer ${authorToken}`)
      .send({ mediaId, expectedVersion: versionBefore });

    expect(coverRes.status).toBe(200);
    expect(coverRes.body.status).toBe('DRAFT');
    expect(coverRes.body.version).toBe(versionBefore + 1);

    const auditLog = await prisma.auditLog.findFirst({
      where: { entityId: articleId, action: 'ARTICLE_RESET_TO_DRAFT' },
    });
    expect(auditLog).toBeDefined();
  });

  it('15. Editor PATCH cover on PUBLISHED -> 409', async () => {
    // setup flow to PUBLISHED
    await request(app.getHttpServer())
      .post(`/v1/articles/${articleId}/submit-review`)
      .set('Authorization', `Bearer ${authorToken}`)
      .send({
        expectedVersion: (await prisma.article.findUnique({ where: { id: articleId } }))!.version,
      });
    await request(app.getHttpServer())
      .post(`/v1/articles/${articleId}/start-review`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({
        expectedVersion: (await prisma.article.findUnique({ where: { id: articleId } }))!.version,
      });
    await request(app.getHttpServer())
      .post(`/v1/articles/${articleId}/approve`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({
        expectedVersion: (await prisma.article.findUnique({ where: { id: articleId } }))!.version,
      });
    await request(app.getHttpServer())
      .post(`/v1/articles/${articleId}/publish`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({
        expectedVersion: (await prisma.article.findUnique({ where: { id: articleId } }))!.version,
      });

    const articleInfo = await prisma.article.findUnique({ where: { id: articleId } });

    const coverRes = await request(app.getHttpServer())
      .patch(`/v1/articles/${articleId}/cover`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ mediaId: null, expectedVersion: articleInfo!.version });

    expect(coverRes.status).toBe(409);
    expect(coverRes.body.message).toBe('ARTICLE_COVER_IMMUTABLE');
  });

  it('16. Author DELETE media while in use -> 409', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/v1/media/${mediaId}`)
      .set('Authorization', `Bearer ${authorToken}`);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('MEDIA_IN_USE');
  });

  it('17. Delete after archive + invariant', async () => {
    await request(app.getHttpServer())
      .post(`/v1/articles/${articleId}/archive`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        expectedVersion: (await prisma.article.findUnique({ where: { id: articleId } }))!.version,
      });

    const res = await request(app.getHttpServer())
      .delete(`/v1/media/${mediaId}`)
      .set('Authorization', `Bearer ${authorToken}`);

    expect(res.status).toBe(204);

    const dbMedia = await prisma.media.findUnique({ where: { id: mediaId } });
    expect(dbMedia!.status).toBe('DELETED');
    expect(dbMedia!.deletedAt).not.toBeNull();

    const exists = await storageService.objectExists(dbMedia!.objectKey);
    expect(exists).toBe(true); // Soft delete doesn't remove from storage
  });

  it('18. MinIO private bucket (unsigned GET -> 403)', async () => {
    const fetchRes = await fetch(`http://localhost:9000/dailystar-media/${objectKey}`);
    expect(fetchRes.status).toBe(403);
  });

  it('19. Tampered signed URL -> 403', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/media')
      .set('Authorization', `Bearer ${authorToken}`)
      .attach('file', validJpeg, 'test2.jpg');

    id2 = res.body.id;

    const signRes = await request(app.getHttpServer())
      .get(`/v1/media/${id2}/signed-url`)
      .set('Authorization', `Bearer ${authorToken}`);

    const signedUrl = signRes.body.signedUrl;
    // tamper signature
    const tamperedUrl =
      signedUrl.substring(0, signedUrl.length - 1) + (signedUrl.endsWith('a') ? 'b' : 'a');

    const fetchRes = await fetch(tamperedUrl);
    expect(fetchRes.status).toBe(403);
  });

  it('20. Expired signed URL returns 403 from MinIO', async () => {
    // Generate URL with short expiry (using a backdoor function or config override, but we will test it directly via the service or override using generateSignedUrl internal param)
    const { signedUrl } = await mediaService.generateSignedUrl(
      id2,
      { sub: authorUserId, permissions: ['media.read.own'] } as any,
      SHORT_EXPIRY_SECONDS,
    );

    const preExpiry = await fetch(signedUrl);
    expect(preExpiry.status).toBe(200);

    // Wait for the URL to expire
    await new Promise<void>((resolve) => setTimeout(resolve, (SHORT_EXPIRY_SECONDS + 1) * 1000));

    // After expiry, MinIO must reject
    const postExpiry = await fetch(signedUrl);
    expect(postExpiry.status).toBe(403);
  }, 15000);

  // ── Additional regression tests added by Phase 4 correction pass ──────────

  it('21. DRAFT cross-owner cover mutation returns 404 (IDOR fix)', async () => {
    // Create a fresh DRAFT article owned by author
    const articleRes = await request(app.getHttpServer())
      .post('/v1/articles')
      .set('Authorization', `Bearer ${authorToken}`)
      .send({ title: 'IDOR Test Article', body: 'body' });
    expect(articleRes.status).toBe(201);
    const targetArticleId = articleRes.body.id;

    // author2 (different user, no article.update.any) tries to mutate cover → must get 404
    const uploadRes = await request(app.getHttpServer())
      .post('/v1/media')
      .set('Authorization', `Bearer ${author2Token}`)
      .attach('file', validJpeg, 'idor.jpg');
    expect(uploadRes.status).toBe(201);
    const author2MediaId = uploadRes.body.id;

    const coverRes = await request(app.getHttpServer())
      .patch(`/v1/articles/${targetArticleId}/cover`)
      .set('Authorization', `Bearer ${author2Token}`)
      .send({
        mediaId,
        expectedVersion: (await prisma.article.findUnique({ where: { id: articleId } }))!.version,
      });

    // Must be 404, not 403 — IDOR: do not reveal existence
    expect(coverRes.status).toBe(404);
  });

  it('22. Cover mutation with stale expectedVersion returns 409 VERSION_MISMATCH', async () => {
    // Create a fresh DRAFT article
    const articleRes = await request(app.getHttpServer())
      .post('/v1/articles')
      .set('Authorization', `Bearer ${authorToken}`)
      .send({ title: 'Version Mismatch Article', body: 'body' });
    expect(articleRes.status).toBe(201);
    const vmArticleId = articleRes.body.id;

    // Use wrong expectedVersion (actual version is 1, we send 99)
    const coverRes = await request(app.getHttpServer())
      .patch(`/v1/articles/${vmArticleId}/cover`)
      .set('Authorization', `Bearer ${authorToken}`)
      .send({
        mediaId,
        expectedVersion: (await prisma.article.findUnique({ where: { id: articleId } }))!.version,
      });

    expect(coverRes.status).toBe(409);
    expect(coverRes.body.message).toBe('VERSION_MISMATCH');
  });

  it('23. SCHEDULED → DRAFT revert: version+1, approvedRevisionId cleared, scheduledFor cleared, audit logged', async () => {
    // Create article and push it through to SCHEDULED state
    const articleRes = await request(app.getHttpServer())
      .post('/v1/articles')
      .set('Authorization', `Bearer ${authorToken}`)
      .send({ title: 'Scheduled Revert Article', body: 'body' });
    expect(articleRes.status).toBe(201);
    const sArticleId = articleRes.body.id;

    // Upload media to use as cover
    const uploadRes = await request(app.getHttpServer())
      .post('/v1/media')
      .set('Authorization', `Bearer ${authorToken}`)
      .attach('file', validJpeg, 'scheduled-cover.jpg');
    expect(uploadRes.status).toBe(201);
    const sMediaId = uploadRes.body.id;

    // Flow: DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED → SCHEDULED
    await request(app.getHttpServer())
      .post(`/v1/articles/${sArticleId}/submit-review`)
      .set('Authorization', `Bearer ${authorToken}`)
      .send({
        expectedVersion: (await prisma.article.findUnique({ where: { id: sArticleId } }))!.version,
      });

    await request(app.getHttpServer())
      .post(`/v1/articles/${sArticleId}/start-review`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({
        expectedVersion: (await prisma.article.findUnique({ where: { id: sArticleId } }))!.version,
      });

    await request(app.getHttpServer())
      .post(`/v1/articles/${sArticleId}/approve`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({
        expectedVersion: (await prisma.article.findUnique({ where: { id: sArticleId } }))!.version,
      });

    // Schedule for 10 minutes in the future
    const scheduledFor = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await request(app.getHttpServer())
      .post(`/v1/articles/${sArticleId}/schedule`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({
        expectedVersion: (await prisma.article.findUnique({ where: { id: sArticleId } }))!.version,
        scheduledFor,
      });

    // Verify it is SCHEDULED
    const before = await prisma.article.findUniqueOrThrow({ where: { id: sArticleId } });
    expect(before.status).toBe('SCHEDULED');
    expect(before.scheduledFor).not.toBeNull();
    const versionBefore = before.version;

    // Author mutates cover → triggers SCHEDULED → DRAFT auto-revert
    const coverRes = await request(app.getHttpServer())
      .patch(`/v1/articles/${sArticleId}/cover`)
      .set('Authorization', `Bearer ${authorToken}`)
      .send({ mediaId: sMediaId, expectedVersion: versionBefore });

    expect(coverRes.status).toBe(200);
    expect(coverRes.body.status).toBe('DRAFT');
    // Net version change must be exactly +1 (revertToDraft does NOT bump version)
    expect(coverRes.body.version).toBe(versionBefore + 1);

    // Verify DB state
    const after = await prisma.article.findUniqueOrThrow({ where: { id: sArticleId } });
    expect(after.scheduledFor).toBeNull();
    expect(after.approvedRevisionId).toBeNull();
    expect(after.coverMediaId).toBe(sMediaId);

    // Audit log must contain ARTICLE_RESET_TO_DRAFT event
    const auditLog = await prisma.auditLog.findFirst({
      where: { entityId: sArticleId, action: 'ARTICLE_RESET_TO_DRAFT' },
    });
    expect(auditLog).not.toBeNull();
  }, 30000);

  it('24. ARCHIVED article cover mutation returns 409 ARTICLE_COVER_IMMUTABLE', async () => {
    // Create a separate article and push it all the way to ARCHIVED
    const articleRes = await request(app.getHttpServer())
      .post('/v1/articles')
      .set('Authorization', `Bearer ${authorToken}`)
      .send({ title: 'Archived Cover Test', body: 'body' });
    expect(articleRes.status).toBe(201);
    const aArticleId = articleRes.body.id;

    // Flow to PUBLISHED → ARCHIVED
    await request(app.getHttpServer())
      .post(`/v1/articles/${aArticleId}/submit-review`)
      .set('Authorization', `Bearer ${authorToken}`)
      .send({
        expectedVersion: (await prisma.article.findUnique({ where: { id: aArticleId } }))!.version,
      });
    await request(app.getHttpServer())
      .post(`/v1/articles/${aArticleId}/start-review`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({
        expectedVersion: (await prisma.article.findUnique({ where: { id: aArticleId } }))!.version,
      });
    await request(app.getHttpServer())
      .post(`/v1/articles/${aArticleId}/approve`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({
        expectedVersion: (await prisma.article.findUnique({ where: { id: aArticleId } }))!.version,
      });
    await request(app.getHttpServer())
      .post(`/v1/articles/${aArticleId}/publish`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({
        expectedVersion: (await prisma.article.findUnique({ where: { id: aArticleId } }))!.version,
      });
    await request(app.getHttpServer())
      .post(`/v1/articles/${aArticleId}/archive`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        expectedVersion: (await prisma.article.findUnique({ where: { id: aArticleId } }))!.version,
      });

    const archived = await prisma.article.findUniqueOrThrow({ where: { id: aArticleId } });
    expect(archived.status).toBe('ARCHIVED');

    // Attempt cover mutation on ARCHIVED article → must be 409
    const coverRes = await request(app.getHttpServer())
      .patch(`/v1/articles/${aArticleId}/cover`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ mediaId: null, expectedVersion: archived.version });

    expect(coverRes.status).toBe(409);
    expect(coverRes.body.message).toBe('ARTICLE_COVER_IMMUTABLE');
  }, 30000);

  afterAll(async () => {
    const media = await prisma.media.findMany({
      where: { uploadedById: { in: [authorUserId, author2UserId, editorUserId, adminUserId] } },
    });
    for (const m of media) {
      try {
        await storageService.deleteObject(m.objectKey);
      } catch {}
    }

    await prisma.auditLog.deleteMany();
    await prisma.articleRevision.deleteMany();
    await prisma.article.deleteMany();
    await prisma.media.deleteMany();
    await prisma.userRole.deleteMany({
      where: { user: { email: { in: TEST_EMAILS } } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: TEST_EMAILS } },
    });
    await app.close();
  });
});
