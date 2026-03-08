import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectMongo, disconnectMongo } from './config/mongo.js';
import { createApp } from './app.js';
import { AdminUserModel } from './modules/admin/admin.models.js';
import { hashPassword } from './modules/admin/admin.password.js';
import { OrderModel, OrderOperationAuditModel } from './modules/orders/orders.models.js';
import { UserModel } from './modules/user/user.models.js';

describe('Admin order transitions', () => {
  let mongo: MongoMemoryServer;
  const app = createApp();
  let adminAccessToken: string;
  let employeeAccessToken: string;
  let createdOrderId: string;
  let kycBlockedOrderId: string;
  let paymentBlockedOrderId: string;
  let deliveredOrderId: string;

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

    const adminLogin = await request(app).post('/api/v1/admin/auth/login').send({ email: 'admin@buzzbar.com', password: 'password12345' });
    adminAccessToken = adminLogin.body.data.token as string;

    const employeeLogin = await request(app).post('/api/v1/admin/auth/login').send({ email: 'employee@buzzbar.com', password: 'password12345' });
    employeeAccessToken = employeeLogin.body.data.token as string;

    const verifiedUser = await UserModel.create({
      email: 'verified@buzzbar.com',
      passwordHash: 'x',
      emailVerified: true,
      kycStatus: 'verified'
    } as any);
    const pendingUser = await UserModel.create({
      email: 'pending@buzzbar.com',
      passwordHash: 'x',
      emailVerified: true,
      kycStatus: 'pending'
    } as any);

    const baseOrder = {
      addressSnapshot: { fullAddress: 'Test', area: 'Kathmandu' },
      items: [],
      subtotal: 0,
      discount: 0,
      deliveryFee: 0,
      total: 0
    };

    createdOrderId = (
      await OrderModel.create({
        ...baseOrder,
        orderNumber: 'BB-2026-000701',
        userId: verifiedUser._id,
        status: 'CREATED',
        paymentMethod: 'COD',
        paymentStatus: 'UNPAID',
        kycGateStatus: 'PASS',
        kycStatusSnapshot: 'verified'
      } as any)
    )._id.toString();

    kycBlockedOrderId = (
      await OrderModel.create({
        ...baseOrder,
        orderNumber: 'BB-2026-000702',
        userId: pendingUser._id,
        status: 'KYC_PENDING_REVIEW',
        paymentMethod: 'COD',
        paymentStatus: 'UNPAID',
        kycGateStatus: 'REVIEW_REQUIRED',
        kycStatusSnapshot: 'pending'
      } as any)
    )._id.toString();

    paymentBlockedOrderId = (
      await OrderModel.create({
        ...baseOrder,
        orderNumber: 'BB-2026-000703',
        userId: verifiedUser._id,
        status: 'CONFIRMED',
        paymentMethod: 'WALLET',
        paymentStatus: 'PENDING',
        kycGateStatus: 'PASS',
        kycStatusSnapshot: 'verified'
      } as any)
    )._id.toString();

    deliveredOrderId = (
      await OrderModel.create({
        ...baseOrder,
        orderNumber: 'BB-2026-000704',
        userId: verifiedUser._id,
        status: 'DELIVERED',
        paymentMethod: 'COD',
        paymentStatus: 'UNPAID',
        kycGateStatus: 'PASS',
        kycStatusSnapshot: 'verified'
      } as any)
    )._id.toString();
  });

  afterAll(async () => {
    await disconnectMongo();
    await mongo.stop();
  });

  it('valid transition succeeds and records audit', async () => {
    const res = await request(app)
      .post(`/api/v1/admin/orders/${createdOrderId}/transition`)
      .set('Authorization', `Bearer ${employeeAccessToken}`)
      .send({ actionId: 'CONFIRM_ORDER' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CONFIRMED');
    expect(res.body.data.actionId).toBe('CONFIRM_ORDER');

    const order = await OrderModel.findById(createdOrderId).lean().exec();
    expect((order as any)?.status).toBe('CONFIRMED');

    const audit = await OrderOperationAuditModel.findOne({ orderId: createdOrderId, actionId: 'CONFIRM_ORDER' }).lean().exec();
    expect(audit).toBeTruthy();
    expect((audit as any)?.type).toBe('STATUS_TRANSITION');
    expect((audit as any)?.toStatus).toBe('CONFIRMED');
  });

  it('rejects invalid transition action ids', async () => {
    const res = await request(app)
      .post(`/api/v1/admin/orders/${createdOrderId}/transition`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ actionId: 'MARK_DELIVERED' });

    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe('ORDER_TRANSITION_INVALID');
  });

  it('enforces KYC and payment guards', async () => {
    const kycRes = await request(app)
      .post(`/api/v1/admin/orders/${kycBlockedOrderId}/transition`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ actionId: 'CONFIRM_ORDER' });
    expect(kycRes.status).toBe(409);
    expect(kycRes.body.errorCode).toBe('KYC_REVIEW_REQUIRED');

    const paymentRes = await request(app)
      .post(`/api/v1/admin/orders/${paymentBlockedOrderId}/transition`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ actionId: 'MOVE_TO_PACKING' });
    expect(paymentRes.status).toBe(409);
    expect(paymentRes.body.errorCode).toBe('PAYMENT_NOT_PAID');
  });

  it('blocks transitions after delivery', async () => {
    const res = await request(app)
      .post(`/api/v1/admin/orders/${deliveredOrderId}/transition`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ actionId: 'CANCEL_ORDER' });

    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe('ORDER_ALREADY_DELIVERED');
  });
});
