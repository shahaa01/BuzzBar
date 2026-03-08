import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectMongo, disconnectMongo } from './config/mongo.js';
import { createApp } from './app.js';
import { AdminUserModel } from './modules/admin/admin.models.js';
import { hashPassword } from './modules/admin/admin.password.js';

describe('2C.2 brands: logo nullable', () => {
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

  it('can set and clear brand logo via PUT /admin/brands/:id', async () => {
    const created = await request(app)
      .post('/api/v1/admin/brands')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'Acme', slug: 'acme', isActive: true });
    expect(created.status).toBe(201);
    const id = created.body.data._id as string;

    const setLogo = await request(app)
      .put(`/api/v1/admin/brands/${id}`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ logo: { url: 'https://example.com/logo.webp', publicId: 'buzzbar/brands/acme/logo' } });
    expect(setLogo.status).toBe(200);
    expect(setLogo.body.success).toBe(true);
    expect(setLogo.body.data.logo?.publicId).toBe('buzzbar/brands/acme/logo');

    const clearLogo = await request(app)
      .put(`/api/v1/admin/brands/${id}`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ logo: null });
    expect(clearLogo.status).toBe(200);
    expect(clearLogo.body.success).toBe(true);
    expect(clearLogo.body.data.logo).toBeUndefined();
  });
});

