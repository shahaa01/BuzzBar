import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectMongo, disconnectMongo } from './config/mongo.js';
import { createApp } from './app.js';
import { AdminUserModel } from './modules/admin/admin.models.js';
import { hashPassword } from './modules/admin/admin.password.js';

describe('P2.2C catalog admin reads: categories + brands', () => {
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

  it('lists and reads categories (includes inactive) with stable response shape', async () => {
    const createActive = await request(app)
      .post('/api/v1/admin/categories')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'Beer', slug: 'beer', sortOrder: 1, isActive: true });
    expect(createActive.status).toBe(201);

    const createInactive = await request(app)
      .post('/api/v1/admin/categories')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'Spirits', slug: 'spirits', sortOrder: 2, isActive: false });
    expect(createInactive.status).toBe(201);

    const listAll = await request(app)
      .get('/api/v1/admin/categories?isActive=all&page=1&limit=20')
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(listAll.status).toBe(200);
    expect(listAll.body.success).toBe(true);
    expect(Array.isArray(listAll.body.data.items)).toBe(true);
    expect(listAll.body.data.total).toBe(2);

    const listActive = await request(app)
      .get('/api/v1/admin/categories?isActive=active&page=1&limit=20')
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(listActive.status).toBe(200);
    expect(listActive.body.data.items).toHaveLength(1);
    expect(listActive.body.data.items[0].name).toBe('Beer');

    const id = createActive.body.data._id as string;
    const getOne = await request(app)
      .get(`/api/v1/admin/categories/${id}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(getOne.status).toBe(200);
    expect(getOne.body.success).toBe(true);
    expect(getOne.body.data.id).toBeDefined();
    expect(getOne.body.data.name).toBe('Beer');
  });

  it('lists and reads brands (includes inactive) with stable response shape', async () => {
    const createActive = await request(app)
      .post('/api/v1/admin/brands')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'Acme', slug: 'acme', isActive: true });
    expect(createActive.status).toBe(201);

    const createInactive = await request(app)
      .post('/api/v1/admin/brands')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'OldCo', slug: 'oldco', isActive: false });
    expect(createInactive.status).toBe(201);

    const listAll = await request(app)
      .get('/api/v1/admin/brands?isActive=all&page=1&limit=20')
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(listAll.status).toBe(200);
    expect(listAll.body.success).toBe(true);
    expect(Array.isArray(listAll.body.data.items)).toBe(true);
    expect(listAll.body.data.total).toBe(2);

    const listActive = await request(app)
      .get('/api/v1/admin/brands?isActive=active&page=1&limit=20')
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(listActive.status).toBe(200);
    expect(listActive.body.data.items).toHaveLength(1);
    expect(listActive.body.data.items[0].name).toBe('Acme');

    const id = createActive.body.data._id as string;
    const getOne = await request(app)
      .get(`/api/v1/admin/brands/${id}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(getOne.status).toBe(200);
    expect(getOne.body.success).toBe(true);
    expect(getOne.body.data.id).toBeDefined();
    expect(getOne.body.data.name).toBe('Acme');
  });
});

