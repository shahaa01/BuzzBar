import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectMongo, disconnectMongo } from './config/mongo.js';
import { createApp } from './app.js';
import { AdminUserModel } from './modules/admin/admin.models.js';
import { hashPassword } from './modules/admin/admin.password.js';
import { BrandModel, CategoryModel, ProductModel } from './modules/catalog/catalog.models.js';
import { PromoUsageModel, PromotionModel } from './modules/promotions/promotions.models.js';

describe('Admin promotion detail operator read model', () => {
  let mongo: MongoMemoryServer;
  const app = createApp();
  let employeeAccessToken: string;
  let promotionId: string;
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

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-08T12:00:00.000Z'));

    await AdminUserModel.create({
      email: 'employee@buzzbar.com',
      passwordHash: await hashPassword('password12345'),
      role: 'employee',
      isActive: true
    });

    const login = await request(app).post('/api/v1/admin/auth/login').send({ email: 'employee@buzzbar.com', password: 'password12345' });
    employeeAccessToken = login.body.data.token as string;

    const category = await CategoryModel.create({ name: 'Whiskey', slug: 'whiskey', isActive: true, sortOrder: 1 });
    const brand = await BrandModel.create({ name: 'Jack Daniels', slug: 'jack-daniels', isActive: false });
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

    const promotion = await PromotionModel.create({
      code: 'NIGHTCAP',
      title: 'Night Cap',
      description: 'Late-hour operator promo',
      type: 'PERCENT',
      value: 15,
      minSubtotal: 1500,
      maxDiscount: 500,
      usageLimitTotal: 10,
      usageLimitPerUser: 2,
      startAt: new Date('2026-03-09T12:00:00.000Z'),
      endAt: new Date('2026-03-20T12:00:00.000Z'),
      isActive: true,
      eligibleCategoryIds: [category._id],
      eligibleBrandIds: [brand._id],
      eligibleProductIds: [product._id],
      excludeDiscountedItems: true
    } as any);

    promotionId = promotion._id.toString();

    await PromoUsageModel.create([
      { promoId: promotion._id, userId: category._id, usedCount: 3 },
      { promoId: promotion._id, userId: brand._id, usedCount: 2 }
    ] as any);
  });

  afterAll(async () => {
    vi.useRealTimers();
    await disconnectMongo();
    await mongo.stop();
  });

  it('returns operator-facing overview, validation, usage and linked business rules', async () => {
    const res = await request(app)
      .get(`/api/v1/admin/promotions/${promotionId}`)
      .set('Authorization', `Bearer ${employeeAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      code: 'NIGHTCAP',
      usageCount: 5,
      usageSummary: {
        totalRedemptions: 5,
        remainingUses: 5,
        perUserLimit: 2,
        totalLimit: 10,
        isExhausted: false
      },
      validation: {
        liveValidityStatus: 'scheduled',
        invalidConfiguration: false
      },
      linkedBusinessRules: {
        minSubtotal: 1500,
        maxDiscount: 500,
        excludeDiscountedItems: true
      }
    });

    expect(res.body.data.eligibilitySummary.whoCanUseIt).toContain('category restriction');
    expect(res.body.data.eligibilitySummary.categories).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: categoryId, name: 'Whiskey', slug: 'whiskey' })])
    );
    expect(res.body.data.linkedBusinessRules.eligibleBrands).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: brandId, name: 'Jack Daniels', isActive: false })])
    );
    expect(res.body.data.eligibilitySummary.products).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: productId, name: 'No 7' })])
    );
    expect(res.body.data.validation.warnings).toContain('Promotion has not started yet.');
    expect(res.body.data.validation.checkoutHints).toContain('This promo will fail at checkout until its start time is reached.');
  });
});
