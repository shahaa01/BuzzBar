import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectMongo, disconnectMongo } from './config/mongo.js';
import { createApp } from './app.js';
import { AdminUserModel } from './modules/admin/admin.models.js';
import { hashPassword } from './modules/admin/admin.password.js';
import { CategoryModel, BrandModel, ProductModel, VariantModel } from './modules/catalog/catalog.models.js';

describe('P2.2B Inventory adjust requires reason and records actor', () => {
  let mongo: MongoMemoryServer;
  const app = createApp();
  let employeeAccessToken: string;
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
      email: 'employee@buzzbar.com',
      passwordHash: await hashPassword('password12345'),
      role: 'employee',
      isActive: true
    });

    const login = await request(app).post('/api/v1/admin/auth/login').send({ email: 'employee@buzzbar.com', password: 'password12345' });
    expect(login.status).toBe(200);
    employeeAccessToken = login.body.data.token as string;

    const category = await CategoryModel.create({ name: 'Cat', slug: 'cat', sortOrder: 0, isActive: true });
    const brand = await BrandModel.create({ name: 'Brand', slug: 'brand', isActive: true });
    const product = await ProductModel.create({ name: 'Prod', slug: 'prod', brandId: brand._id, categoryId: category._id, isActive: true });
    const variant = await VariantModel.create({ productId: product._id, sku: 'SKU-1', volumeMl: 750, packSize: 1, price: 1000, isActive: true });
    variantId = variant._id.toString();
  });

  afterAll(async () => {
    await disconnectMongo();
    await mongo.stop();
  });

  it('rejects adjust without reason', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/inventory/adjust')
      .set('Authorization', `Bearer ${employeeAccessToken}`)
      .send({ variantId, delta: 5 });
    expect(res.status).toBe(400);
  });

  it('creates movement with quantityBefore/After and actor', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/inventory/adjust')
      .set('Authorization', `Bearer ${employeeAccessToken}`)
      .send({ variantId, delta: 5, reason: 'receive initial stock' });
    expect(res.status).toBe(200);
    expect(res.body.data.movement).toBeTruthy();
    expect(res.body.data.movement.actorAdminId).toBeTruthy();
    expect(res.body.data.movement.reason).toBe('receive initial stock');
    expect(res.body.data.movement.quantityBefore).toBe(0);
    expect(res.body.data.movement.quantityAfter).toBe(5);
  });
});

