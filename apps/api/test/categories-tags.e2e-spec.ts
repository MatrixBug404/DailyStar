import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import cookieParser from 'cookie-parser';
import { prisma } from '../src/database/client';

describe('Categories and Tags (e2e)', () => {
  jest.setTimeout(30000);
  let app: INestApplication;
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

    await prisma.user.deleteMany({
      where: { email: 'admin_e2e@dailystar.local' },
    });

    await prisma.category.deleteMany({
      where: { name: { startsWith: 'Cat ' } },
    });

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'admin_e2e@dailystar.local', password: 'password123', displayName: 'Admin' });
    const adminUser = await prisma.user.findUnique({
      where: { email: 'admin_e2e@dailystar.local' },
    });
    await prisma.userRole.deleteMany({ where: { userId: adminUser!.id } });
    await prisma.userRole.create({
      data: {
        userId: adminUser!.id,
        roleId: (await prisma.role.findUnique({ where: { name: 'admin' } }))!.id,
      },
    });

    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin_e2e@dailystar.local', password: 'password123' });
    adminSession = adminLogin.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  let cat1Id: string, cat2Id: string, cat3Id: string;

  it('/v1/categories (POST) - Hierarchy depth limit enforcement', async () => {
    const cat1 = await request(app.getHttpServer())
      .post('/v1/categories')
      .set('Authorization', `Bearer ${adminSession}`)
      .send({ name: 'Cat 1' });
    expect(cat1.status).toBe(201);
    cat1Id = cat1.body.id;

    const cat2 = await request(app.getHttpServer())
      .post('/v1/categories')
      .set('Authorization', `Bearer ${adminSession}`)
      .send({ name: 'Cat 2', parentId: cat1Id });
    expect(cat2.status).toBe(201);
    cat2Id = cat2.body.id;

    const cat3 = await request(app.getHttpServer())
      .post('/v1/categories')
      .set('Authorization', `Bearer ${adminSession}`)
      .send({ name: 'Cat 3', parentId: cat2Id });
    expect(cat3.status).toBe(201);
    cat3Id = cat3.body.id;

    const cat4 = await request(app.getHttpServer())
      .post('/v1/categories')
      .set('Authorization', `Bearer ${adminSession}`)
      .send({ name: 'Cat 4', parentId: cat3Id });
    expect(cat4.status).toBe(400);
  });

  it('/v1/categories/:id (DELETE) - Block deletion if in use', async () => {
    const delRes = await request(app.getHttpServer())
      .delete(`/v1/categories/${cat1Id}`)
      .set('Authorization', `Bearer ${adminSession}`);
    expect(delRes.status).toBe(409);
  });
});
