import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectMongo, disconnectMongo } from './config/mongo.js';
import { createApp } from './app.js';
import { AdminUserModel } from './modules/admin/admin.models.js';
import { hashPassword } from './modules/admin/admin.password.js';

describe('2C.3 products + variants CRUD basics', () => {
  let mongo: MongoMemoryServer;
  const app = createApp();
  let adminAccessToken: string;
  let employeeAccessToken: string;

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

    await AdminUserModel.create({
      email: 'employee@buzzbar.com',
      passwordHash: await hashPassword('password12345'),
      role: 'employee',
      isActive: true
    });

    const loginAdmin = await request(app).post('/api/v1/admin/auth/login').send({ email: 'admin@buzzbar.com', password: 'password12345' });
    expect(loginAdmin.status).toBe(200);
    adminAccessToken = loginAdmin.body.data.token as string;

    const loginEmployee = await request(app)
      .post('/api/v1/admin/auth/login')
      .send({ email: 'employee@buzzbar.com', password: 'password12345' });
    expect(loginEmployee.status).toBe(200);
    employeeAccessToken = loginEmployee.body.data.token as string;
  });

  afterAll(async () => {
    await disconnectMongo();
    await mongo.stop();
  });

  it('allows employee read-only on products, but admin can manage variants and deactivation cascades', async () => {
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

    const employeeCreate = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${employeeAccessToken}`)
      .send({ name: 'Nope', slug: 'nope', brandId: brand.body.data._id, categoryId: category.body.data._id, isActive: true });
    expect(employeeCreate.status).toBe(403);
    expect(employeeCreate.body.errorCode).toBe('ADMIN_FORBIDDEN');

    const listEmployee = await request(app)
      .get('/api/v1/admin/products?page=1&limit=20')
      .set('Authorization', `Bearer ${employeeAccessToken}`);
    expect(listEmployee.status).toBe(200);
    expect(listEmployee.body.success).toBe(true);

    const detailEmployee = await request(app)
      .get(`/api/v1/admin/products/${productId}`)
      .set('Authorization', `Bearer ${employeeAccessToken}`);
    expect(detailEmployee.status).toBe(200);
    expect(detailEmployee.body.success).toBe(true);

    const variant = await request(app)
      .post(`/api/v1/admin/products/${productId}/variants`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ sku: 'SKU-750', volumeMl: 750, price: 1000, mrp: 1200, isActive: true });
    expect(variant.status).toBe(201);
    const variantId = variant.body.data._id as string;

    const updVariant = await request(app)
      .put(`/api/v1/admin/variants/${variantId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ price: 900 });
    expect(updVariant.status).toBe(200);

    const deactivateVariant = await request(app)
      .delete(`/api/v1/admin/variants/${variantId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(deactivateVariant.status).toBe(200);

    const afterDeactivateVariant = await request(app)
      .get(`/api/v1/admin/products/${productId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(afterDeactivateVariant.status).toBe(200);
    const vRow = (afterDeactivateVariant.body.data.variants as any[]).find((v) => v.id === variantId);
    expect(vRow?.isActive).toBe(false);

    const deactivateProduct = await request(app)
      .delete(`/api/v1/admin/products/${productId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(deactivateProduct.status).toBe(200);

    const afterDeactivateProduct = await request(app)
      .get(`/api/v1/admin/products/${productId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(afterDeactivateProduct.status).toBe(200);
    expect(afterDeactivateProduct.body.data.product.isActive).toBe(false);
    for (const v of afterDeactivateProduct.body.data.variants as any[]) {
      expect(v.isActive).toBe(false);
    }
  });
});

