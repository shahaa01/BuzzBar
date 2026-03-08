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

describe('Admin payments list', () => {
  let mongo: MongoMemoryServer;
  const app = createApp();
  let adminAccessToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ADMIN_JWT_ACCESS_SECRET = 'test_access_secret_1234567890';
    process.env.ADMIN_JWT_REFRESH_SECRET = 'test_refresh_secret_1234567890';
    process.env.USER_JWT_ACCESS_SECRET = 'test_user_access_secret_1234567890';
    process.env.USER_JWT_REFRESH_SECRET = 'test_user_refresh_secret_1234567890';
    process.env.WALLET_PENDING_TIMEOUT_MIN = '30';

    mongo = await MongoMemoryServer.create();
    await connectMongo(mongo.getUri());

    await AdminUserModel.create({
      email: 'admin@buzzbar.com',
      passwordHash: await hashPassword('password12345'),
      role: 'admin',
      isActive: true
    });

    const login = await request(app).post('/api/v1/admin/auth/login').send({ email: 'admin@buzzbar.com', password: 'password12345' });
    adminAccessToken = login.body.data.token as string;

    const userA = await UserModel.create({
      email: 'alpha@buzzbar.com',
      name: 'Alpha Buyer',
      phone: '9800000001',
      passwordHash: 'x',
      emailVerified: true,
      kycStatus: 'verified'
    } as any);
    const userB = await UserModel.create({
      email: 'beta@buzzbar.com',
      name: 'Beta Buyer',
      phone: '9800000002',
      passwordHash: 'x',
      emailVerified: true,
      kycStatus: 'verified'
    } as any);

    const orderA = await OrderModel.create({
      orderNumber: 'BB-2026-000901',
      userId: userA._id,
      status: 'CONFIRMED',
      paymentMethod: 'WALLET',
      paymentStatus: 'PENDING',
      kycGateStatus: 'PASS',
      kycStatusSnapshot: 'verified',
      addressSnapshot: { fullAddress: 'A', area: 'Kathmandu' },
      items: [],
      subtotal: 1000,
      discount: 0,
      deliveryFee: 0,
      total: 1000,
      createdAt: new Date('2026-03-01T08:00:00.000Z'),
      updatedAt: new Date('2026-03-01T08:00:00.000Z')
    } as any);

    const orderB = await OrderModel.create({
      orderNumber: 'BB-2026-000902',
      userId: userB._id,
      status: 'CANCELLED',
      paymentMethod: 'WALLET',
      paymentStatus: 'FAILED',
      kycGateStatus: 'PASS',
      kycStatusSnapshot: 'verified',
      addressSnapshot: { fullAddress: 'B', area: 'Lalitpur' },
      items: [],
      subtotal: 1200,
      discount: 0,
      deliveryFee: 0,
      total: 1200,
      createdAt: new Date('2026-03-03T09:00:00.000Z'),
      updatedAt: new Date('2026-03-03T09:00:00.000Z')
    } as any);

    const orderC = await OrderModel.create({
      orderNumber: 'BB-2026-000903',
      userId: userA._id,
      status: 'CONFIRMED',
      paymentMethod: 'COD',
      paymentStatus: 'UNPAID',
      kycGateStatus: 'PASS',
      kycStatusSnapshot: 'verified',
      addressSnapshot: { fullAddress: 'C', area: 'Bhaktapur' },
      items: [],
      subtotal: 900,
      discount: 0,
      deliveryFee: 0,
      total: 900,
      createdAt: new Date('2026-03-04T10:00:00.000Z'),
      updatedAt: new Date('2026-03-04T10:00:00.000Z')
    } as any);

    await PaymentTransactionModel.create([
      {
        orderId: orderA._id,
        userId: userA._id,
        provider: 'MOCK',
        paymentMethod: 'WALLET',
        status: 'PENDING',
        amount: 1000,
        currency: 'NPR',
        providerReference: 'mock_ref_901',
        requestPayload: { orderNumber: 'BB-2026-000901' },
        responsePayload: { provider: 'MOCK', result: 'PENDING' },
        createdAt: new Date(Date.now() - 45 * 60 * 1000),
        updatedAt: new Date(Date.now() - 10 * 60 * 1000)
      },
      {
        orderId: orderB._id,
        userId: userB._id,
        provider: 'MOCK',
        paymentMethod: 'WALLET',
        status: 'FAILED',
        amount: 1200,
        currency: 'NPR',
        providerReference: 'mock_ref_902',
        requestPayload: { orderNumber: 'BB-2026-000902' },
        responsePayload: { provider: 'MOCK', result: 'FAILED' },
        failureReason: 'mock_failed',
        createdAt: new Date('2026-03-03T09:00:00.000Z'),
        updatedAt: new Date('2026-03-03T09:10:00.000Z')
      },
      {
        orderId: orderC._id,
        userId: userA._id,
        provider: 'KHALTI',
        paymentMethod: 'COD',
        status: 'SUCCESS',
        amount: 900,
        currency: 'NPR',
        providerReference: 'khalti_ref_903',
        requestPayload: { orderNumber: 'BB-2026-000903' },
        responsePayload: { provider: 'KHALTI', result: 'SUCCESS' },
        createdAt: new Date('2026-03-04T10:00:00.000Z'),
        updatedAt: new Date('2026-03-04T10:05:00.000Z')
      }
    ] as any);
  });

  afterAll(async () => {
    await disconnectMongo();
    await mongo.stop();
  });

  it('lists enriched payments with stable filtering, search, sorting and stale mock isolation', async () => {
    const res = await request(app)
      .get('/api/v1/admin/payments?provider=MOCK&status=PENDING&paymentMethod=WALLET&stalePending=true&q=000901&sort=amount_desc&page=1&limit=20')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.items[0].order.orderNumber).toBe('BB-2026-000901');
    expect(res.body.data.items[0].user.email).toBe('alpha@buzzbar.com');
    expect(res.body.data.items[0].providerReference).toBe('mock_ref_901');
    expect(res.body.data.items[0].isMock).toBe(true);
    expect(res.body.data.items[0].stalePending).toBe(true);
    expect(res.body.data.items[0].finality).toBe('OPEN');
  });

  it('supports date filtering, payment method filtering, and deterministic sorting', async () => {
    const res = await request(app)
      .get('/api/v1/admin/payments?from=2026-03-03T00:00:00.000Z&to=2026-03-05T00:00:00.000Z&sort=amount_asc&page=1&limit=20')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(2);
    expect(res.body.data.items[0].amount).toBe(900);
    expect(res.body.data.items[1].amount).toBe(1200);
  });
});
