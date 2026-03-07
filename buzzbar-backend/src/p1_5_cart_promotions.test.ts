import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectMongo, disconnectMongo } from './config/mongo.js';
import { createApp } from './app.js';
import { CategoryModel, BrandModel, ProductModel, VariantModel } from './modules/catalog/catalog.models.js';
import { InventoryStockModel } from './modules/inventory/inventory.models.js';
import { PromotionModel, PromoUsageModel } from './modules/promotions/promotions.models.js';

describe('P1.5 cart + promotions (deterministic pricing)', () => {
  let mongo: MongoMemoryServer;
  const app = createApp();

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.USER_JWT_ACCESS_SECRET = 'test_user_access_secret_1234567890';
    process.env.USER_JWT_REFRESH_SECRET = 'test_user_refresh_secret_1234567890';
    process.env.ADMIN_JWT_ACCESS_SECRET = 'test_admin_access_secret_1234567890';
    process.env.ADMIN_JWT_REFRESH_SECRET = 'test_admin_refresh_secret_1234567890';

    mongo = await MongoMemoryServer.create();
    await connectMongo(mongo.getUri());
  });

  afterAll(async () => {
    await disconnectMongo();
    await mongo.stop();
  });

  async function signup(email: string) {
    const res = await request(app).post('/api/v1/auth/signup').send({ email, password: 'password123', name: 'X' });
    expect(res.status).toBe(201);
    return { token: res.body.data.token as string, userId: res.body.data.user.id as string };
  }

  async function seedVariant(opts: { price: number; mrp?: number; available: number }) {
    const category = await CategoryModel.create({ name: 'Cat', slug: `cat-${Date.now()}` });
    const brand = await BrandModel.create({ name: 'Brand', slug: `brand-${Date.now()}` });
    const product = await ProductModel.create({
      name: 'Product A',
      slug: `product-a-${Date.now()}`,
      brandId: brand._id,
      categoryId: category._id,
      images: [{ url: 'https://example.com/a.png', publicId: 'p1', format: 'png' }]
    });
    const variant = await VariantModel.create({
      productId: product._id,
      sku: `SKU-${Date.now()}`,
      volumeMl: 750,
      packSize: 1,
      price: opts.price,
      mrp: opts.mrp,
      isActive: true
    });
    await InventoryStockModel.create({ variantId: variant._id, quantity: opts.available, reserved: 0 });
    return { variantId: variant._id.toString(), productId: product._id.toString() };
  }

  it('Cart add/update/remove computes deterministic subtotal and validates availability', async () => {
    const { token } = await signup('cart1@buzzbar.com');
    const { variantId } = await seedVariant({ price: 4200, available: 3 });

    const add = await request(app)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ variantId, qty: 2 });
    expect(add.status).toBe(200);
    expect(add.body.data.subtotal).toBe(8400);
    expect(add.body.data.expandedItems[0].variant.price).toBe(4200);
    expect(add.body.data.expandedItems[0].product.name).toBe('Product A');

    const patch = await request(app)
      .patch(`/api/v1/cart/items/${variantId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ qty: 3 });
    expect(patch.status).toBe(200);
    expect(patch.body.data.subtotal).toBe(12_600);

    const tooMuch = await request(app)
      .patch(`/api/v1/cart/items/${variantId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ qty: 4 });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.errorCode).toBe('INSUFFICIENT_STOCK');

    const remove = await request(app)
      .delete(`/api/v1/cart/items/${variantId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(remove.status).toBe(200);
    expect(remove.body.data.subtotal).toBe(0);
    expect(remove.body.data.items.length).toBe(0);
  });

  it('Promo validate returns reasons and deterministic discount math (floor) + maxDiscount', async () => {
    const { token, userId } = await signup('promo1@buzzbar.com');
    const { variantId } = await seedVariant({ price: 1000, available: 10 });

    await request(app)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ variantId, qty: 5 }); // subtotal=5000

    await PromotionModel.create({
      code: 'EXPIRED10',
      type: 'PERCENT',
      value: 10,
      startAt: new Date('2020-01-01T00:00:00.000Z'),
      endAt: new Date('2020-01-02T00:00:00.000Z'),
      isActive: true
    });

    const expired = await request(app)
      .post('/api/v1/promotions/validate')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'expired10' });
    expect(expired.status).toBe(200);
    expect(expired.body.data.isValid).toBe(false);
    expect(expired.body.data.reasons).toContain('PROMO_EXPIRED');

    await PromotionModel.create({
      code: 'FUTURE10',
      type: 'PERCENT',
      value: 10,
      startAt: new Date('2099-01-01T00:00:00.000Z'),
      endAt: new Date('2099-12-31T00:00:00.000Z'),
      isActive: true
    });

    const future = await request(app)
      .post('/api/v1/promotions/validate')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'FUTURE10' });
    expect(future.body.data.isValid).toBe(false);
    expect(future.body.data.reasons).toContain('PROMO_NOT_STARTED');

    await PromotionModel.create({
      code: 'MIN6000',
      type: 'FLAT',
      value: 500,
      startAt: new Date('2020-01-01T00:00:00.000Z'),
      endAt: new Date('2099-12-31T00:00:00.000Z'),
      minSubtotal: 6000,
      isActive: true
    });
    const minGate = await request(app)
      .post('/api/v1/promotions/validate')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'MIN6000' });
    expect(minGate.body.data.isValid).toBe(false);
    expect(minGate.body.data.reasons).toContain('MIN_SUBTOTAL_NOT_MET');

    const promo = await PromotionModel.create({
      code: 'PCT15MAX400',
      type: 'PERCENT',
      value: 15,
      startAt: new Date('2020-01-01T00:00:00.000Z'),
      endAt: new Date('2099-12-31T00:00:00.000Z'),
      maxDiscount: 400,
      isActive: true
    });

    const ok = await request(app)
      .post('/api/v1/promotions/validate')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'pct15max400' });
    expect(ok.body.data.isValid).toBe(true);
    expect(ok.body.data.subtotal).toBe(5000);
    // 15% of 5000 = 750, capped at 400
    expect(ok.body.data.discountAmount).toBe(400);
    expect(ok.body.data.maxDiscountApplied).toBe(true);
    expect(ok.body.data.newTotal).toBe(4600);

    await PromoUsageModel.create({ promoId: promo._id, userId, usedCount: 2 });
    await PromotionModel.updateOne({ _id: promo._id }, { $set: { usageLimitPerUser: 2 } });
    const perUser = await request(app)
      .post('/api/v1/promotions/validate')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'PCT15MAX400' });
    expect(perUser.body.data.isValid).toBe(false);
    expect(perUser.body.data.reasons).toContain('USAGE_LIMIT_PER_USER_REACHED');
  });

  it('Total usage limit respected and determinism holds across runs', async () => {
    const { token, userId: _userId } = await signup('promo2@buzzbar.com');
    const other = await signup('promo3@buzzbar.com');
    const { variantId } = await seedVariant({ price: 999, available: 10 });

    await request(app)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ variantId, qty: 3 }); // subtotal=2997

    const promo = await PromotionModel.create({
      code: 'FLAT100',
      type: 'FLAT',
      value: 100,
      startAt: new Date('2020-01-01T00:00:00.000Z'),
      endAt: new Date('2099-12-31T00:00:00.000Z'),
      usageLimitTotal: 3,
      isActive: true
    });

    await PromoUsageModel.create({ promoId: promo._id, userId: other.userId, usedCount: 3 });
    const limited = await request(app)
      .post('/api/v1/promotions/validate')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'flat100' });
    expect(limited.body.data.isValid).toBe(false);
    expect(limited.body.data.reasons).toContain('USAGE_LIMIT_TOTAL_REACHED');

    await PromotionModel.updateOne({ _id: promo._id }, { $set: { usageLimitTotal: 999 } });
    const a = await request(app)
      .post('/api/v1/promotions/validate')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'FLAT100' });
    const b = await request(app)
      .post('/api/v1/promotions/validate')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'FLAT100' });
    expect(a.body.data).toEqual(b.body.data);
    expect(a.body.data.subtotal).toBe(2997);
    expect(a.body.data.discountAmount).toBe(100);
    expect(a.body.data.newTotal).toBe(2897);
  });
});
