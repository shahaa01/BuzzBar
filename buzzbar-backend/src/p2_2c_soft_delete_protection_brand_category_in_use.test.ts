import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectMongo, disconnectMongo } from './config/mongo.js';
import { createApp } from './app.js';
import { AdminUserModel } from './modules/admin/admin.models.js';
import { hashPassword } from './modules/admin/admin.password.js';

describe('P2.2C catalog soft-delete protection (category/brand in use)', () => {
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

  it('blocks deactivating a category/brand referenced by any product', async () => {
    const category = await request(app)
      .post('/api/v1/admin/categories')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'Cat', slug: 'cat', isActive: true });
    expect(category.status).toBe(201);

    const brand = await request(app)
      .post('/api/v1/admin/brands')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'Brand', slug: 'brand', isActive: true });
    expect(brand.status).toBe(201);

    const product = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'Product', slug: 'product', brandId: brand.body.data._id, categoryId: category.body.data._id, isActive: true });
    expect(product.status).toBe(201);

    const delCategory = await request(app)
      .delete(`/api/v1/admin/categories/${category.body.data._id}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(delCategory.status).toBe(409);
    expect(delCategory.body.errorCode).toBe('CATEGORY_IN_USE');

    const delBrand = await request(app)
      .delete(`/api/v1/admin/brands/${brand.body.data._id}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(delBrand.status).toBe(409);
    expect(delBrand.body.errorCode).toBe('BRAND_IN_USE');
  });
});

