import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectMongo, disconnectMongo } from './config/mongo.js';
import { createApp } from './app.js';
import { AdminUserModel } from './modules/admin/admin.models.js';
import { hashPassword } from './modules/admin/admin.password.js';
import { BrandModel, CategoryModel, ProductModel } from './modules/catalog/catalog.models.js';
import { PromotionModel } from './modules/promotions/promotions.models.js';

describe('Admin promotions write flows', () => {
  let mongo: MongoMemoryServer;
  const app = createApp();
  let adminAccessToken: string;
  let employeeAccessToken: string;
  let categoryId: string;
  let brandId: string;
  let productId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ADMIN_JWT_ACCESS_SECRET = 'test_access_secret_1234567890';
    process.env.ADMIN_JWT_REFRESH_SECRET = 'test_refresh_secret_1234567890';
    process.env.USER_JWT_ACCESS_SECRET = 'test_user_access_secret_1234567890';
    process.env.USER_JWT_REFRESH_SECRET = 'test_user_refresh_secret_1234567890';

    mongo = await MongoMemoryServer.create();
    await connectMongo(mongo.getUri());

    await AdminUserModel.create([
      {
        email: 'admin@buzzbar.com',
        passwordHash: await hashPassword('password12345'),
        role: 'admin',
        isActive: true
      },
      {
        email: 'employee@buzzbar.com',
        passwordHash: await hashPassword('password12345'),
        role: 'employee',
        isActive: true
      }
    ]);

    const [adminLogin, employeeLogin] = await Promise.all([
      request(app).post('/api/v1/admin/auth/login').send({ email: 'admin@buzzbar.com', password: 'password12345' }),
      request(app).post('/api/v1/admin/auth/login').send({ email: 'employee@buzzbar.com', password: 'password12345' })
    ]);
    adminAccessToken = adminLogin.body.data.token as string;
    employeeAccessToken = employeeLogin.body.data.token as string;

    const category = await CategoryModel.create({ name: 'Whiskey', slug: 'whiskey', isActive: true, sortOrder: 1 });
    const brand = await BrandModel.create({ name: 'Jack Daniels', slug: 'jack-daniels', isActive: true });
    const product = await ProductModel.create({
      name: 'No 7',
      slug: 'no-7',
      categoryId: category._id,
      brandId: brand._id,
      isActive: true
    } as any);

    categoryId = category._id.toString();
    brandId = brand._id.toString();
    productId = product._id.toString();
  });

  afterAll(async () => {
    await disconnectMongo();
    await mongo.stop();
  });

  it('creates and updates a promotion with eligibility fields', async () => {
    const createRes = await request(app)
      .post('/api/v1/admin/promotions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        code: 'launchnight',
        title: 'Launch Night',
        description: 'Launch-only promo',
        type: 'PERCENT',
        value: 10,
        minSubtotal: 1500,
        maxDiscount: 500,
        usageLimitTotal: 100,
        usageLimitPerUser: 2,
        startAt: '2026-03-08T12:00:00.000Z',
        endAt: '2026-03-10T12:00:00.000Z',
        isActive: true,
        eligibleCategoryIds: [categoryId],
        eligibleBrandIds: [brandId],
        eligibleProductIds: [productId],
        excludeDiscountedItems: true
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.data).toMatchObject({
      code: 'LAUNCHNIGHT',
      title: 'Launch Night',
      description: 'Launch-only promo',
      type: 'PERCENT',
      value: 10,
      minSubtotal: 1500,
      maxDiscount: 500,
      usageLimitTotal: 100,
      usageLimitPerUser: 2,
      eligibleCategoryIds: [categoryId],
      eligibleBrandIds: [brandId],
      eligibleProductIds: [productId],
      excludeDiscountedItems: true
    });

    const updateRes = await request(app)
      .put(`/api/v1/admin/promotions/${createRes.body.data.id}`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        code: 'launchnight',
        title: 'Launch Night Final',
        description: 'Updated promo',
        type: 'FLAT',
        value: 300,
        minSubtotal: 2000,
        maxDiscount: null,
        usageLimitTotal: 50,
        usageLimitPerUser: 1,
        startAt: '2026-03-08T12:00:00.000Z',
        endAt: '2026-03-12T12:00:00.000Z',
        isActive: false,
        eligibleCategoryIds: [],
        eligibleBrandIds: [brandId],
        eligibleProductIds: [],
        excludeDiscountedItems: false
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data).toMatchObject({
      code: 'LAUNCHNIGHT',
      title: 'Launch Night Final',
      description: 'Updated promo',
      type: 'FLAT',
      value: 300,
      minSubtotal: 2000,
      usageLimitTotal: 50,
      usageLimitPerUser: 1,
      isActive: false,
      eligibleCategoryIds: [],
      eligibleBrandIds: [brandId],
      eligibleProductIds: [],
      excludeDiscountedItems: false
    });
  });

  it('rejects invalid windows, duplicate codes, and employee writes', async () => {
    await PromotionModel.create({
      code: 'EXISTING10',
      title: 'Existing',
      type: 'PERCENT',
      value: 10,
      startAt: new Date('2026-03-01T00:00:00.000Z'),
      endAt: new Date('2026-03-30T00:00:00.000Z'),
      isActive: true
    } as any);

    const invalidWindow = await request(app)
      .post('/api/v1/admin/promotions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        code: 'BADWINDOW',
        title: 'Bad Window',
        type: 'PERCENT',
        value: 10,
        startAt: '2026-03-10T12:00:00.000Z',
        endAt: '2026-03-08T12:00:00.000Z',
        isActive: true
      });
    expect(invalidWindow.status).toBe(400);

    const duplicateCode = await request(app)
      .post('/api/v1/admin/promotions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        code: 'existing10',
        title: 'Duplicate',
        type: 'PERCENT',
        value: 10,
        startAt: '2026-03-08T12:00:00.000Z',
        endAt: '2026-03-09T12:00:00.000Z',
        isActive: true
      });
    expect(duplicateCode.status).toBe(409);
    expect(duplicateCode.body.errorCode).toBe('PROMO_CODE_ALREADY_EXISTS');

    const employeeWrite = await request(app)
      .post('/api/v1/admin/promotions')
      .set('Authorization', `Bearer ${employeeAccessToken}`)
      .send({
        code: 'EMPFAIL',
        title: 'Blocked',
        type: 'PERCENT',
        value: 10,
        startAt: '2026-03-08T12:00:00.000Z',
        endAt: '2026-03-09T12:00:00.000Z',
        isActive: true
      });
    expect(employeeWrite.status).toBe(403);
  });
});
