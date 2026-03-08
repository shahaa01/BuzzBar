import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectMongo, disconnectMongo } from './config/mongo.js';
import { createApp } from './app.js';
import { AdminUserModel } from './modules/admin/admin.models.js';
import { hashPassword } from './modules/admin/admin.password.js';

describe('2C.3 products images: max 12 + order persistence', () => {
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

  it('enforces 12 image limit and persists image order', async () => {
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

    const imgA = { url: 'https://example.com/a.webp', publicId: 'a', width: 100, height: 100, format: 'webp' };
    const imgB = { url: 'https://example.com/b.webp', publicId: 'b', width: 100, height: 100, format: 'webp' };

    const product = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        name: 'Product',
        slug: 'product',
        brandId: brand.body.data._id,
        categoryId: category.body.data._id,
        images: [imgA, imgB],
        isActive: true
      });
    expect(product.status).toBe(201);
    const productId = product.body.data._id as string;

    const upd = await request(app)
      .put(`/api/v1/admin/products/${productId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ images: [imgB, imgA] });
    expect(upd.status).toBe(200);

    const detail = await request(app)
      .get(`/api/v1/admin/products/${productId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.product.images?.[0]?.publicId).toBe('b');
    expect(detail.body.data.product.images?.[1]?.publicId).toBe('a');

    const tooMany = Array.from({ length: 13 }).map((_, idx) => ({
      url: `https://example.com/${idx}.webp`,
      publicId: `pid-${idx}`
    }));
    const updTooMany = await request(app)
      .put(`/api/v1/admin/products/${productId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ images: tooMany });
    expect(updTooMany.status).toBe(400);
    expect(updTooMany.body.errorCode).toBe('VALIDATION_ERROR');
  });
});

