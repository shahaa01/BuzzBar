import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectMongo, disconnectMongo } from './config/mongo.js';
import { createApp } from './app.js';
import { AdminUserModel } from './modules/admin/admin.models.js';
import { hashPassword } from './modules/admin/admin.password.js';

describe('2C.2 categories: image nullable', () => {
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

  it('can set and clear category image via PUT /admin/categories/:id', async () => {
    const created = await request(app)
      .post('/api/v1/admin/categories')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'Beer', slug: 'beer', isActive: true });
    expect(created.status).toBe(201);
    const id = created.body.data._id as string;

    const setImage = await request(app)
      .put(`/api/v1/admin/categories/${id}`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ image: { url: 'https://example.com/cat.webp', publicId: 'buzzbar/categories/beer/image' } });
    expect(setImage.status).toBe(200);
    expect(setImage.body.success).toBe(true);
    expect(setImage.body.data.image?.publicId).toBe('buzzbar/categories/beer/image');

    const clearImage = await request(app)
      .put(`/api/v1/admin/categories/${id}`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ image: null });
    expect(clearImage.status).toBe(200);
    expect(clearImage.body.success).toBe(true);
    expect(clearImage.body.data.image).toBeUndefined();
  });
});

