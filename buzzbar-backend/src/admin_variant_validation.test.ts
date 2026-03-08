import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectMongo, disconnectMongo } from './config/mongo.js';
import { createApp } from './app.js';
import { AdminUserModel } from './modules/admin/admin.models.js';
import { hashPassword } from './modules/admin/admin.password.js';

describe('2C.3 variant validation', () => {
  let mongo: MongoMemoryServer;
  const app = createApp();
  let adminAccessToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ADMIN_JWT_ACCESS_SECRET = 'test_access_secret_1234567890';
    process.env.ADMIN_JWT_REFRESH_SECRET = 'test_refresh_secret_1234567890';
    process.env.USER_JWT_ACCESS_SECRET = 'test_user_access_secret_1234567890';
    process.env.USER_JWT_REFRESH_SECRET = 'test_user_refresh_secret_1234567890';

    mongo = await MongoMemoryServer.create();
    await connectMongo(mongo.getUri());

    await AdminUserModel.create({
      email: 'admin@buzzbar.com',
      passwordHash: await hashPassword('password12345'),
      role: 'admin',
      isActive: true
    });

    const login = await request(app).post('/api/v1/admin/auth/login').send({ email: 'admin@buzzbar.com', password: 'password12345' });
    expect(login.status).toBe(200);
    adminAccessToken = login.body.data.token as string;
  });

  afterAll(async () => {
    await disconnectMongo();
    await mongo.stop();
  });

  it('rejects price > mrp on create and update', async () => {
    const category = await request(app)
      .post('/api/v1/admin/categories')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'Cat', slug: 'cat', isActive: true });
    const brand = await request(app)
      .post('/api/v1/admin/brands')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'Brand', slug: 'brand', isActive: true });
    expect(category.status).toBe(201);
    expect(brand.status).toBe(201);

    const product = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'Product', slug: 'product', brandId: brand.body.data._id, categoryId: category.body.data._id, isActive: true });
    expect(product.status).toBe(201);
    const productId = product.body.data._id as string;

    const badCreate = await request(app)
      .post(`/api/v1/admin/products/${productId}/variants`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ sku: 'SKU-BAD', volumeMl: 750, price: 1000, mrp: 900, isActive: true });
    expect(badCreate.status).toBe(400);
    expect(badCreate.body.errorCode).toBe('PRICE_GT_MRP');

    const good = await request(app)
      .post(`/api/v1/admin/products/${productId}/variants`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ sku: 'SKU-GOOD', volumeMl: 750, price: 900, mrp: 1000, isActive: true });
    expect(good.status).toBe(201);
    const variantId = good.body.data._id as string;

    const badUpdate = await request(app)
      .put(`/api/v1/admin/variants/${variantId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ price: 1500 });
    expect(badUpdate.status).toBe(400);
    expect(badUpdate.body.errorCode).toBe('PRICE_GT_MRP');
  });

  it('prevents activating a variant under an inactive product', async () => {
    const category = await request(app)
      .post('/api/v1/admin/categories')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'Cat2', slug: 'cat2', isActive: true });
    const brand = await request(app)
      .post('/api/v1/admin/brands')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'Brand2', slug: 'brand2', isActive: true });
    expect(category.status).toBe(201);
    expect(brand.status).toBe(201);

    const productInactive = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'Inactive', slug: 'inactive', brandId: brand.body.data._id, categoryId: category.body.data._id, isActive: false });
    expect(productInactive.status).toBe(201);

    const badVariant = await request(app)
      .post(`/api/v1/admin/products/${productInactive.body.data._id}/variants`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ sku: 'SKU-INACT', volumeMl: 750, price: 1000 });
    expect(badVariant.status).toBe(409);
    expect(badVariant.body.errorCode).toBe('PRODUCT_INACTIVE');

    const okInactiveVariant = await request(app)
      .post(`/api/v1/admin/products/${productInactive.body.data._id}/variants`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ sku: 'SKU-INACT-OFF', volumeMl: 750, price: 1000, isActive: false });
    expect(okInactiveVariant.status).toBe(201);

    const attemptActivate = await request(app)
      .put(`/api/v1/admin/variants/${okInactiveVariant.body.data._id}`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ isActive: true });
    expect(attemptActivate.status).toBe(409);
    expect(attemptActivate.body.errorCode).toBe('PRODUCT_INACTIVE');
  });
});

