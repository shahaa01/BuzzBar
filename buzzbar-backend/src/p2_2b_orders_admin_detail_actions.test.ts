import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectMongo, disconnectMongo } from './config/mongo.js';
import { createApp } from './app.js';
import { AdminUserModel } from './modules/admin/admin.models.js';
import { hashPassword } from './modules/admin/admin.password.js';
import { UserModel } from './modules/user/user.models.js';
import { OrderModel } from './modules/orders/orders.models.js';

describe('P2.2B Orders admin detail actions', () => {
  let mongo: MongoMemoryServer;
  const app = createApp();
  let employeeAccessToken: string;
  let orderIdKycPending: string;
  let orderIdWalletUnpaid: string;

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

    const loginEmp = await request(app).post('/api/v1/admin/auth/login').send({ email: 'employee@buzzbar.com', password: 'password12345' });
    employeeAccessToken = loginEmp.body.data.token as string;

    const userPending = await UserModel.create({
      email: 'u_pending@buzzbar.com',
      passwordHash: 'x',
      emailVerified: true,
      kycStatus: 'pending'
    } as any);

    const userVerified = await UserModel.create({
      email: 'u_verified@buzzbar.com',
      passwordHash: 'x',
      emailVerified: true,
      kycStatus: 'verified'
    } as any);

    const baseOrder = {
      addressSnapshot: { fullAddress: 'x', area: 'Kathmandu' },
      items: [],
      subtotal: 0,
      discount: 0,
      deliveryFee: 0,
      total: 0
    };

    const o1 = await OrderModel.create({
      ...baseOrder,
      orderNumber: 'BB-2026-000100',
      userId: userPending._id,
      status: 'KYC_PENDING_REVIEW',
      paymentMethod: 'COD',
      paymentStatus: 'UNPAID',
      kycGateStatus: 'REVIEW_REQUIRED',
      kycStatusSnapshot: 'pending'
    } as any);
    orderIdKycPending = o1._id.toString();

    const o2 = await OrderModel.create({
      ...baseOrder,
      orderNumber: 'BB-2026-000101',
      userId: userVerified._id,
      status: 'CONFIRMED',
      paymentMethod: 'WALLET',
      paymentStatus: 'PENDING',
      kycGateStatus: 'PASS',
      kycStatusSnapshot: 'verified'
    } as any);
    orderIdWalletUnpaid = o2._id.toString();
  });

  afterAll(async () => {
    await disconnectMongo();
    await mongo.stop();
  });

  it('KYC_PENDING_REVIEW order: CONFIRMED action is blocked when user not verified', async () => {
    const res = await request(app)
      .get(`/api/v1/admin/orders/${orderIdKycPending}`)
      .set('Authorization', `Bearer ${employeeAccessToken}`);
    expect(res.status).toBe(200);
    const actions = res.body.data.actions as any[];
    const confirm = actions.find((a) => a.to === 'CONFIRMED');
    expect(confirm).toBeTruthy();
    expect(confirm.allowed).toBe(false);
    expect(confirm.reasonCode).toBe('KYC_REVIEW_REQUIRED');
  });

  it('CONFIRMED wallet unpaid: PACKING action is blocked', async () => {
    const res = await request(app)
      .get(`/api/v1/admin/orders/${orderIdWalletUnpaid}`)
      .set('Authorization', `Bearer ${employeeAccessToken}`);
    expect(res.status).toBe(200);
    const actions = res.body.data.actions as any[];
    const packing = actions.find((a) => a.to === 'PACKING');
    expect(packing).toBeTruthy();
    expect(packing.allowed).toBe(false);
    expect(packing.reasonCode).toBe('PAYMENT_NOT_PAID');
  });
});
