import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import cookieParser from 'cookie-parser';
import { prisma } from '../src/database/client';

describe('AuthController (e2e)', () => {
  jest.setTimeout(30000);

  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    app.use(cookieParser());
    await app.init();

    // Clear users before tests (only test users, keep seed users)
    await prisma.user.deleteMany({
      where: { email: { in: ['test@example.com', 'hacker@example.com'] } }
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  const testUser = {
    email: 'test@example.com',
    password: 'password123',
    displayName: 'Test User',
  };

  let refreshTokenCookie: string;

  it('/auth/register (POST) - success', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send(testUser)
      .expect(201);

    expect(response.body).toHaveProperty('accessToken');
    expect(response.body).toHaveProperty('user');
    expect(response.body.user.email).toBe(testUser.email);

    // Check cookie
    const cookies = response.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect(cookies[0]).toMatch(/refreshToken=/);
    refreshTokenCookie = cookies[0].split(';')[0];
  });

  it('/auth/register (POST) - duplicate email fails', async () => {
    const res = await request(app.getHttpServer()).post('/auth/register').send(testUser);
    if (res.status !== 409) console.log('Duplicate Email Error:', res.body);
    expect(res.status).toBe(409);
  });

  it('/auth/register (POST) - attempt admin role fails', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        ...testUser,
        email: 'hacker@example.com',
        role: 'admin',
      });
    if (res.status !== 201) console.log('Admin Role Error:', res.body);
    expect(res.status).toBe(201);
    const user = await prisma.user.findUnique({
      where: { email: 'hacker@example.com' },
      include: { roles: { include: { role: true } } },
    });
    expect(user?.roles[0].role.name).toBe('author');
  });

  it('/auth/login (POST) - success', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: testUser.email, password: testUser.password });

    if (response.status !== 200) console.log('Login Error:', response.body);
    expect(response.status).toBe(200);

    expect(response.body).toHaveProperty('accessToken');
    const cookies = response.headers['set-cookie'];
    expect(cookies).toBeDefined();
    refreshTokenCookie = cookies[0].split(';')[0];
  });

  it('/auth/login (POST) - invalid credentials', () => {
    return request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: testUser.email, password: 'wrongpassword' })
      .expect(401);
  });

  it('/auth/refresh (POST) - success', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', refreshTokenCookie)
      .expect(200);

    expect(response.body).toHaveProperty('accessToken');
    const cookies = response.headers['set-cookie'];
    refreshTokenCookie = cookies[0].split(';')[0]; // Store new rotated cookie
  });

  it('/auth/logout (POST) - success', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', refreshTokenCookie)
      .expect(200);

    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect(cookies[0]).toMatch(/refreshToken=;/);

    const [sessionId] = refreshTokenCookie.split('=')[1].split('.');
    const session = await prisma.refreshSession.findUnique({ where: { id: sessionId } });
    expect(session?.revokedAt).not.toBeNull();
  });

  it('/auth/refresh (POST) - revoked token fails', () => {
    // Attempt to use the rotated/revoked token
    return request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', refreshTokenCookie)
      .expect(401);
  });

  it('/users/me (GET) - unauthenticated fails', () => {
    return request(app.getHttpServer()).get('/users/me').expect(401);
  });

  it('/users/me (GET) - authenticated success', async () => {
    // Login to get access token
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: testUser.email, password: testUser.password })
      .expect(200);

    const accessToken = loginRes.body.accessToken;

    const res = await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.email).toBe(testUser.email);
    expect(res.body.passwordHash).toBeUndefined(); // Never return hash
  });
});
