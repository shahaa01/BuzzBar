import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectMongo, disconnectMongo } from './config/mongo.js';
import { createApp } from './app.js';
import { AdminUserModel } from './modules/admin/admin.models.js';
import { hashPassword } from './modules/admin/admin.password.js';

describe('P2.2C duplicate slug/SKU return stable error codes', () => {
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

  it('returns SLUG_ALREADY_EXISTS when updating slug to an existing slug', async () => {
    const a = await request(app)
      .post('/api/v1/admin/categories')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'Cat A', slug: 'dup-slug', isActive: true });
    expect(a.status).toBe(201);

    const b = await request(app)
      .post('/api/v1/admin/categories')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'Cat B', slug: 'other-slug', isActive: true });
    expect(b.status).toBe(201);

    const upd = await request(app)
      .put(`/api/v1/admin/categories/${b.body.data._id}`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ slug: 'dup-slug' });
    expect(upd.status).toBe(409);
    expect(upd.body.errorCode).toBe('SLUG_ALREADY_EXISTS');
  });

  it('returns SKU_ALREADY_EXISTS when creating/updating variants with duplicate SKU', async () => {
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

    const v1 = await request(app)
      .post(`/api/v1/admin/products/${product.body.data._id}/variants`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ sku: 'DUPSKU', volumeMl: 750, packSize: 1, price: 1000, isActive: true });
    expect(v1.status).toBe(201);

    const v2 = await request(app)
      .post(`/api/v1/admin/products/${product.body.data._id}/variants`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ sku: 'DUPSKU', volumeMl: 375, packSize: 1, price: 600, isActive: true });
    expect(v2.status).toBe(409);
    expect(v2.body.errorCode).toBe('SKU_ALREADY_EXISTS');

    const other = await request(app)
      .post(`/api/v1/admin/products/${product.body.data._id}/variants`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ sku: 'SKU2', volumeMl: 500, packSize: 1, price: 800, isActive: true });
    expect(other.status).toBe(201);

    const upd = await request(app)
      .put(`/api/v1/admin/variants/${other.body.data._id}`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ sku: 'DUPSKU' });
    expect(upd.status).toBe(409);
    expect(upd.body.errorCode).toBe('SKU_ALREADY_EXISTS');
  });
});

