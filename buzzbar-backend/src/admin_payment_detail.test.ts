import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectMongo, disconnectMongo } from './config/mongo.js';
import { createApp } from './app.js';
import { AdminUserModel } from './modules/admin/admin.models.js';
import { hashPassword } from './modules/admin/admin.password.js';
import { OrderModel } from './modules/orders/orders.models.js';
import { PaymentTransactionModel } from './modules/payments/payments.models.js';
import { UserModel } from './modules/user/user.models.js';

describe('Admin payment detail', () => {
  let mongo: MongoMemoryServer;
  const app = createApp();
  let adminAccessToken: string;
  let employeeAccessToken: string;
  let paymentId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ADMIN_JWT_ACCESS_SECRET = 'test_access_secret_1234567890';
    process.env.ADMIN_JWT_REFRESH_SECRET = 'test_refresh_secret_1234567890';
    process.env.USER_JWT_ACCESS_SECRET = 'test_user_access_secret_1234567890';
    process.env.USER_JWT_REFRESH_SECRET = 'test_user_refresh_secret_1234567890';
    process.env.WALLET_PENDING_TIMEOUT_MIN = '30';

    const now = Date.now();
    const originalNow = Date.now;
    Date.now = () => now;

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

    const user = await UserModel.create({
      email: 'buyer@buzzbar.com',
      name: 'Buyer',
      phone: '9800000001',
      passwordHash: 'x',
      emailVerified: true,
      kycStatus: 'verified'
    } as any);

    const order = await OrderModel.create({
      orderNumber: 'BB-2026-001001',
      userId: user._id,
      status: 'CONFIRMED',
      paymentMethod: 'WALLET',
      paymentStatus: 'PENDING',
      kycGateStatus: 'PASS',
      kycStatusSnapshot: 'verified',
      addressSnapshot: { fullAddress: 'Kathmandu', area: 'Kathmandu' },
      items: [],
      subtotal: 2500,
      discount: 0,
      deliveryFee: 150,
      total: 2650
    } as any);

    paymentId = (
      await PaymentTransactionModel.create({
        orderId: order._id,
        userId: user._id,
        provider: 'MOCK',
        paymentMethod: 'WALLET',
        status: 'FAILED',
        amount: 2650,
        currency: 'NPR',
        providerReference: 'mock_ref_1001',
        requestPayload: { orderNumber: 'BB-2026-001001', requestId: 'req_123' },
        responsePayload: { provider: 'MOCK', result: 'FAILED', requestId: 'req_123' },
        failureReason: 'mock_failed',
        createdAt: new Date(now - 40 * 60 * 1000),
        updatedAt: new Date(now - 5 * 60 * 1000)
      } as any)
    )._id.toString();

    Date.now = originalNow;
  });

  afterAll(async () => {
    await disconnectMongo();
    await mongo.stop();
  });

  it('returns enriched payment detail with linked order, user, diagnostics and mock lifecycle', async () => {
    const res = await request(app).get(`/api/v1/admin/payments/${paymentId}`).set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.payment.providerReference).toBe('mock_ref_1001');
    expect(res.body.data.order.orderNumber).toBe('BB-2026-001001');
    expect(res.body.data.user.email).toBe('buyer@buzzbar.com');
    expect(res.body.data.snapshots.request.requestId).toBe('req_123');
    expect(res.body.data.diagnostics.failureReason).toBe('mock_failed');
    expect(res.body.data.diagnostics.requestId).toBe('req_123');
    expect(res.body.data.diagnostics.mockLifecycle.providerPath).toBe('MOCK');
    expect(res.body.data.diagnostics.mockLifecycle.steps.some((step: any) => step.id === 'CONFIRM_FAILED')).toBe(true);
  });

  it('returns deterministic not-found and RBAC errors', async () => {
    const notFound = await request(app).get('/api/v1/admin/payments/67c9e0f3123456789abcdef0').set('Authorization', `Bearer ${adminAccessToken}`);
    expect(notFound.status).toBe(404);
    expect(notFound.body.errorCode).toBe('NOT_FOUND');

    const forbidden = await request(app).get(`/api/v1/admin/payments/${paymentId}`).set('Authorization', `Bearer ${employeeAccessToken}`);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.errorCode).toBe('ADMIN_FORBIDDEN');
  });
});
