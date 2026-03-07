import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectMongo, disconnectMongo } from './config/mongo.js';
import { createApp } from './app.js';
import { bootstrapAdminPhase } from './modules/admin/bootstrap.js';
import { AdminUserModel } from './modules/admin/admin.models.js';
import { hashPassword } from './modules/admin/admin.password.js';
import { signAdminAccessToken } from './modules/admin/admin.jwt.js';

describe('P1.1 admin settings + bootstrap + RBAC', () => {
  let mongo: MongoMemoryServer;
  const app = createApp();

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ADMIN_JWT_ACCESS_SECRET = 'test_access_secret_1234567890';
    process.env.ADMIN_JWT_REFRESH_SECRET = 'test_refresh_secret_1234567890';
    process.env.ADMIN_ACCESS_TOKEN_TTL_MIN = '15';
    process.env.ADMIN_REFRESH_TOKEN_TTL_DAYS = '30';
    process.env.USER_JWT_ACCESS_SECRET = 'test_user_access_secret_1234567890';
    process.env.USER_JWT_REFRESH_SECRET = 'test_user_refresh_secret_1234567890';
    process.env.USER_ACCESS_TOKEN_TTL_MIN = '15';
    process.env.USER_REFRESH_TOKEN_TTL_DAYS = '30';
    process.env.SUPERADMIN_BOOTSTRAP_EMAIL = 'owner@buzzbar.com';
    process.env.SUPERADMIN_BOOTSTRAP_PASSWORD = 'very_strong_password';

    mongo = await MongoMemoryServer.create();
    await connectMongo(mongo.getUri());
  });

  afterAll(async () => {
    await disconnectMongo();
    await mongo.stop();
  });

  it('bootstraps SuperAdmin once', async () => {
    await bootstrapAdminPhase({
      NODE_ENV: 'test',
      PORT: 3000,
      MONGO_URI: mongo.getUri(),
      CORS_ORIGINS: undefined,
      ADMIN_JWT_ACCESS_SECRET: process.env.ADMIN_JWT_ACCESS_SECRET!,
      ADMIN_JWT_REFRESH_SECRET: process.env.ADMIN_JWT_REFRESH_SECRET!,
      ADMIN_ACCESS_TOKEN_TTL_MIN: 15,
      ADMIN_REFRESH_TOKEN_TTL_DAYS: 30,
      USER_JWT_ACCESS_SECRET: process.env.USER_JWT_ACCESS_SECRET!,
      USER_JWT_REFRESH_SECRET: process.env.USER_JWT_REFRESH_SECRET!,
      USER_ACCESS_TOKEN_TTL_MIN: 15,
      USER_REFRESH_TOKEN_TTL_DAYS: 30,
      KYC_CONFIDENCE_THRESHOLD: 0.7,
      KYC_DOB_TOLERANCE_DAYS: 90,
      SUPERADMIN_BOOTSTRAP_EMAIL: 'owner@buzzbar.com',
      SUPERADMIN_BOOTSTRAP_PASSWORD: 'very_strong_password',
      SUPERADMIN_BOOTSTRAP_NAME: undefined
    });

    await bootstrapAdminPhase({
      NODE_ENV: 'test',
      PORT: 3000,
      MONGO_URI: mongo.getUri(),
      CORS_ORIGINS: undefined,
      ADMIN_JWT_ACCESS_SECRET: process.env.ADMIN_JWT_ACCESS_SECRET!,
      ADMIN_JWT_REFRESH_SECRET: process.env.ADMIN_JWT_REFRESH_SECRET!,
      ADMIN_ACCESS_TOKEN_TTL_MIN: 15,
      ADMIN_REFRESH_TOKEN_TTL_DAYS: 30,
      USER_JWT_ACCESS_SECRET: process.env.USER_JWT_ACCESS_SECRET!,
      USER_JWT_REFRESH_SECRET: process.env.USER_JWT_REFRESH_SECRET!,
      USER_ACCESS_TOKEN_TTL_MIN: 15,
      USER_REFRESH_TOKEN_TTL_DAYS: 30,
      KYC_CONFIDENCE_THRESHOLD: 0.7,
      KYC_DOB_TOLERANCE_DAYS: 90,
      SUPERADMIN_BOOTSTRAP_EMAIL: 'owner@buzzbar.com',
      SUPERADMIN_BOOTSTRAP_PASSWORD: 'very_strong_password',
      SUPERADMIN_BOOTSTRAP_NAME: undefined
    });

    const count = await AdminUserModel.countDocuments({ role: 'superadmin' });
    expect(count).toBe(1);
  });

  it('blocks employee from updating settings; allows superadmin', async () => {
    const employee = await AdminUserModel.create({
      email: 'emp@buzzbar.com',
      passwordHash: await hashPassword('password12345'),
      role: 'employee',
      isActive: true
    });

    const superadmin = await AdminUserModel.findOne({ role: 'superadmin' });
    expect(superadmin).toBeTruthy();

    const employeeToken = await signAdminAccessToken({ adminId: employee._id.toString(), role: employee.role });
    const superToken = await signAdminAccessToken({ adminId: superadmin!._id.toString(), role: superadmin!.role });

    const denied = await request(app)
      .put('/api/v1/admin/settings')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ deliveryFeeFlat: 20 });
    expect(denied.status).toBe(403);

    const allowed = await request(app)
      .put('/api/v1/admin/settings')
      .set('Authorization', `Bearer ${superToken}`)
      .send({ deliveryFeeFlat: 20 });
    expect(allowed.status).toBe(200);
    expect(allowed.body?.data?.deliveryFeeFlat).toBe(20);
  });

  it('allows admin (not employee) to read settings', async () => {
    const admin = await AdminUserModel.create({
      email: 'admin@buzzbar.com',
      passwordHash: await hashPassword('password12345'),
      role: 'admin',
      isActive: true
    });
    const employee = await AdminUserModel.findOne({ role: 'employee' });

    const adminToken = await signAdminAccessToken({ adminId: admin._id.toString(), role: admin.role });
    const employeeToken = employee
      ? await signAdminAccessToken({ adminId: employee._id.toString(), role: employee.role })
      : '';

    const ok = await request(app).get('/api/v1/admin/settings').set('Authorization', `Bearer ${adminToken}`);
    expect(ok.status).toBe(200);

    if (employeeToken) {
      const denied = await request(app).get('/api/v1/admin/settings').set('Authorization', `Bearer ${employeeToken}`);
      expect(denied.status).toBe(403);
    }
  });

  it('admin auth login/refresh/logout works with refresh rotation', async () => {
    await AdminUserModel.deleteOne({ email: 'authadmin@buzzbar.com' });
    await AdminUserModel.deleteOne({ email: 'authadmin2@buzzbar.com' });

    await AdminUserModel.create({
      email: 'authadmin@buzzbar.com',
      passwordHash: await hashPassword('password12345'),
      role: 'admin',
      isActive: true
    });

    const loginRes = await request(app)
      .post('/api/v1/admin/auth/login')
      .send({ email: 'authadmin@buzzbar.com', password: 'password12345' });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body?.data?.token).toBeTruthy();
    expect(loginRes.body?.data?.refreshToken).toBeTruthy();

    const access1 = loginRes.body.data.token as string;
    const refresh1 = loginRes.body.data.refreshToken as string;

    const refreshRes = await request(app)
      .post('/api/v1/admin/auth/refresh')
      .set('Authorization', `Bearer ${refresh1}`)
      .send({});
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body?.data?.token).toBeTruthy();
    expect(refreshRes.body?.data?.refreshToken).toBeTruthy();

    const access2 = refreshRes.body.data.token as string;
    const refresh2 = refreshRes.body.data.refreshToken as string;

    // Old refresh should be revoked after rotation
    const refreshOld = await request(app)
      .post('/api/v1/admin/auth/refresh')
      .set('Authorization', `Bearer ${refresh1}`)
      .send({});
    expect(refreshOld.status).toBe(401);

    const logoutRes = await request(app)
      .post('/api/v1/admin/auth/logout')
      .set('Authorization', `Bearer ${access2}`)
      .set('x-refresh-token', refresh2)
      .send({});
    expect(logoutRes.status).toBe(200);

    const refreshAfterLogout = await request(app)
      .post('/api/v1/admin/auth/refresh')
      .set('Authorization', `Bearer ${refresh2}`)
      .send({});
    expect(refreshAfterLogout.status).toBe(401);

    // Access token should still be structurally valid until expiry, but auth is stateless.
    // We ensure session revocation affects refresh flows, not access verification.
    expect(access1).toBeTruthy();
  });
});
