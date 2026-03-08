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

describe('Admin order detail read model', () => {
  let mongo: MongoMemoryServer;
  const app = createApp();
  let accessToken: string;
  let orderId: string;
  let kycPendingOrderId: string;

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
    accessToken = login.body.data.token as string;

    const verifiedUser = await UserModel.create({
      email: 'verified@buzzbar.com',
      passwordHash: 'x',
      emailVerified: true,
      name: 'Verified Buyer',
      phone: '9800000001',
      kycStatus: 'verified',
      kycVerifiedAt: new Date('2026-01-05T08:00:00.000Z')
    } as any);

    const pendingUser = await UserModel.create({
      email: 'pending@buzzbar.com',
      passwordHash: 'x',
      emailVerified: true,
      name: 'Pending Buyer',
      phone: '9800000002',
      kycStatus: 'pending'
    } as any);

    const assignedAdmin = await AdminUserModel.create({
      email: 'ops@buzzbar.com',
      passwordHash: await hashPassword('password12345'),
      role: 'employee',
      isActive: true
    });

    const order = await OrderModel.create({
      orderNumber: 'BB-2026-000501',
      userId: verifiedUser._id,
      status: 'CONFIRMED',
      paymentMethod: 'WALLET',
      paymentStatus: 'PENDING',
      kycGateStatus: 'PASS',
      kycStatusSnapshot: 'verified',
      addressSnapshot: {
        fullAddress: 'Naxal, Kathmandu',
        area: 'Kathmandu',
        contactName: 'Verified Buyer',
        contactPhone: '9800000001'
      },
      items: [
        {
          productId: verifiedUser._id,
          variantId: verifiedUser._id,
          productName: "Jack Daniel's No.7",
          brandName: 'Jack Daniel’s',
          sku: 'JD-750',
          volumeMl: 750,
          packSize: 1,
          imageUrl: 'https://example.com/jd.jpg',
          unitPrice: 4200,
          qty: 2,
          lineTotal: 8400
        }
      ],
      promoSnapshot: {
        code: 'SAVE200',
        type: 'FLAT',
        value: 200,
        discountAmount: 200
      },
      subtotal: 8400,
      discount: 200,
      deliveryFee: 150,
      total: 8350,
      assignedToAdminId: assignedAdmin._id,
      assignedAt: new Date('2026-01-06T09:00:00.000Z')
    } as any);
    orderId = order._id.toString();

    await PaymentTransactionModel.create({
      orderId: order._id,
      userId: verifiedUser._id,
      provider: 'MOCK',
      paymentMethod: 'WALLET',
      status: 'PENDING',
      amount: 8350,
      currency: 'NPR',
      providerReference: 'TXN_349234',
      requestPayload: { orderNumber: 'BB-2026-000501' },
      responsePayload: { mode: 'PENDING_THEN_SUCCESS' }
    } as any);

    const kycPendingOrder = await OrderModel.create({
      orderNumber: 'BB-2026-000502',
      userId: pendingUser._id,
      status: 'KYC_PENDING_REVIEW',
      paymentMethod: 'COD',
      paymentStatus: 'UNPAID',
      kycGateStatus: 'REVIEW_REQUIRED',
      kycStatusSnapshot: 'pending',
      addressSnapshot: {
        fullAddress: 'Jawalakhel, Lalitpur',
        area: 'Lalitpur'
      },
      items: [
        {
          productId: pendingUser._id,
          variantId: pendingUser._id,
          productName: 'Signature Whisky',
          volumeMl: 750,
          packSize: 1,
          unitPrice: 2500,
          qty: 1,
          lineTotal: 2500
        }
      ],
      subtotal: 2500,
      discount: 0,
      deliveryFee: 150,
      total: 2650
    } as any);
    kycPendingOrderId = kycPendingOrder._id.toString();
  });

  afterAll(async () => {
    await disconnectMongo();
    await mongo.stop();
  });

  it('returns payment, item snapshot, totals, assignment and allowed actions', async () => {
    const res = await request(app).get(`/api/v1/admin/orders/${orderId}`).set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);

    expect(res.body.data.order.orderNumber).toBe('BB-2026-000501');
    expect(res.body.data.customer.name).toBe('Verified Buyer');
    expect(res.body.data.items[0].productName).toBe("Jack Daniel's No.7");
    expect(res.body.data.items[0].sku).toBe('JD-750');
    expect(res.body.data.totals.total).toBe(8350);
    expect(res.body.data.payment.transaction.provider).toBe('MOCK');
    expect(res.body.data.payment.transaction.providerReference).toBe('TXN_349234');
    expect(res.body.data.assignment.assignedOperator.email).toBe('ops@buzzbar.com');
    expect(res.body.data.inventory.stockReserved).toBe(true);
    expect(res.body.data.inventory.stockDeducted).toBe(false);

    const packing = (res.body.data.actions as any[]).find((action) => action.to === 'PACKING');
    expect(packing).toBeTruthy();
    expect(packing.allowed).toBe(false);
    expect(packing.reasonCode).toBe('PAYMENT_NOT_PAID');
  });

  it('surfaces KYC blocking state and reservation visibility', async () => {
    const res = await request(app).get(`/api/v1/admin/orders/${kycPendingOrderId}`).set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);

    expect(res.body.data.kyc.status).toBe('pending');
    expect(res.body.data.kyc.blockedReason).toContain('KYC review required');
    expect(res.body.data.operational.blockingConditions).toContain('KYC_REVIEW_REQUIRED');
    expect(res.body.data.inventory.stockReserved).toBe(true);
    expect(res.body.data.inventory.reservedUnits).toBe(1);

    const confirm = (res.body.data.actions as any[]).find((action) => action.to === 'CONFIRMED');
    expect(confirm).toBeTruthy();
    expect(confirm.allowed).toBe(false);
    expect(confirm.reasonCode).toBe('KYC_REVIEW_REQUIRED');
  });
});
