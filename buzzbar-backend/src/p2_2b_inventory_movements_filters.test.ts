import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectMongo, disconnectMongo } from './config/mongo.js';
import { createApp } from './app.js';
import { AdminUserModel } from './modules/admin/admin.models.js';
import { hashPassword } from './modules/admin/admin.password.js';
import { CategoryModel, BrandModel, ProductModel, VariantModel } from './modules/catalog/catalog.models.js';

describe('P2.2B Inventory movements filters', () => {
  let mongo: MongoMemoryServer;
  const app = createApp();
  let adminAccessToken: string;
  let employeeAccessToken: string;
  let employeeId: string;
  let sku: string;
  let variantId: string;

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

    const employee = await AdminUserModel.create({
      email: 'employee@buzzbar.com',
      passwordHash: await hashPassword('password12345'),
      role: 'employee',
      isActive: true
    });
    employeeId = employee._id.toString();

    const loginAdmin = await request(app).post('/api/v1/admin/auth/login').send({ email: 'admin@buzzbar.com', password: 'password12345' });
    adminAccessToken = loginAdmin.body.data.token as string;

    const loginEmp = await request(app).post('/api/v1/admin/auth/login').send({ email: 'employee@buzzbar.com', password: 'password12345' });
    employeeAccessToken = loginEmp.body.data.token as string;

    const category = await CategoryModel.create({ name: 'Cat', slug: 'cat', sortOrder: 0, isActive: true });
    const brand = await BrandModel.create({ name: 'Brand', slug: 'brand', isActive: true });
    const product = await ProductModel.create({ name: 'Super Beer', slug: 'super-beer', brandId: brand._id, categoryId: category._id, isActive: true });
    sku = 'SKU-INV-1';
    const variant = await VariantModel.create({ productId: product._id, sku, volumeMl: 750, packSize: 1, price: 1000, isActive: true });
    variantId = variant._id.toString();

    // Create two movements: one by employee, one by admin
    await request(app)
      .patch('/api/v1/admin/inventory/adjust')
      .set('Authorization', `Bearer ${employeeAccessToken}`)
      .send({ variantId, delta: 5, reason: 'employee receive' });

    await request(app)
      .patch('/api/v1/admin/inventory/adjust')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ variantId, delta: -1, reason: 'admin adjust' });
  });

  afterAll(async () => {
    await disconnectMongo();
    await mongo.stop();
  });

  it('forbids employee from movements endpoint', async () => {
    const res = await request(app)
      .get('/api/v1/admin/inventory/movements')
      .set('Authorization', `Bearer ${employeeAccessToken}`);
    expect(res.status).toBe(403);
  });

  it('filters by actorAdminId', async () => {
    const res = await request(app)
      .get(`/api/v1/admin/inventory/movements?actorAdminId=${employeeId}&limit=20&page=1`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBe(1);
    expect(res.body.data.items[0].actor.id).toBe(employeeId);
  });

  it('filters by q (SKU exact, case-insensitive)', async () => {
    const res = await request(app)
      .get(`/api/v1/admin/inventory/movements?q=${encodeURIComponent(sku.toLowerCase())}&limit=20&page=1`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBeGreaterThanOrEqual(2);
    for (const it of res.body.data.items) {
      expect(it.variant.sku).toBe(sku);
    }
  });

  it('rejects invalid limit', async () => {
    const res = await request(app)
      .get('/api/v1/admin/inventory/movements?limit=30&page=1')
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(res.status).toBe(400);
  });
});
