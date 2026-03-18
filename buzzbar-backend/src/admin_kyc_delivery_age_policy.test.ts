import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectMongo, disconnectMongo } from './config/mongo.js';
import { createApp } from './app.js';
import { AdminUserModel } from './modules/admin/admin.models.js';
import { hashPassword } from './modules/admin/admin.password.js';
import { OrderModel } from './modules/orders/orders.models.js';
import { UserModel } from './modules/user/user.models.js';

describe('KYC delivery-age policy admin flows', () => {
  let mongo: MongoMemoryServer;
  const app = createApp();
  let adminAccessToken: string;
  let employeeAccessToken: string;
  let rejectedUserId: string;
  let rejectedOrderId: string;
  let verifiedUserId: string;
  let verifiedOrderId: string;
  let pendingUserId: string;
  let pendingOrderId: string;

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

    const rejectedUser = await UserModel.create({ email: 'rejected@buzzbar.com', passwordHash: 'x', emailVerified: true, kycStatus: 'rejected' } as any);
    rejectedUserId = rejectedUser._id.toString();
    rejectedOrderId = (
      await OrderModel.create({
        orderNumber: 'BB-2026-009001',
        userId: rejectedUser._id,
        status: 'CREATED',
        paymentMethod: 'COD',
        paymentStatus: 'UNPAID',
        kycGateStatus: 'FAIL',
        kycStatusSnapshot: 'rejected',
        deliveryAgeCheckRequired: true,
        progressBlockedReason: 'KYC_REQUIRED',
        addressSnapshot: { fullAddress: 'Test', area: 'Kathmandu' },
        items: [],
        subtotal: 0,
        discount: 0,
        deliveryFee: 0,
        total: 0
      } as any)
    )._id.toString();

    const verifiedUser = await UserModel.create({ email: 'verified@buzzbar.com', passwordHash: 'x', emailVerified: true, kycStatus: 'verified' } as any);
    verifiedUserId = verifiedUser._id.toString();
    verifiedOrderId = (
      await OrderModel.create({
        orderNumber: 'BB-2026-009002',
        userId: verifiedUser._id,
        status: 'OUT_FOR_DELIVERY',
        paymentMethod: 'COD',
        paymentStatus: 'UNPAID',
        kycGateStatus: 'PASS',
        kycStatusSnapshot: 'verified',
        deliveryAgeCheckRequired: true,
        addressSnapshot: { fullAddress: 'Test', area: 'Kathmandu' },
        items: [],
        subtotal: 0,
        discount: 0,
        deliveryFee: 0,
        total: 0
      } as any)
    )._id.toString();

    const pendingUser = await UserModel.create({ email: 'pending@buzzbar.com', passwordHash: 'x', emailVerified: true, kycStatus: 'pending' } as any);
    pendingUserId = pendingUser._id.toString();
    pendingOrderId = (
      await OrderModel.create({
        orderNumber: 'BB-2026-009003',
        userId: pendingUser._id,
        status: 'OUT_FOR_DELIVERY',
        paymentMethod: 'COD',
        paymentStatus: 'UNPAID',
        kycGateStatus: 'REVIEW_REQUIRED',
        kycStatusSnapshot: 'pending',
        deliveryAgeCheckRequired: true,
        addressSnapshot: { fullAddress: 'Test', area: 'Kathmandu' },
        items: [],
        subtotal: 0,
        discount: 0,
        deliveryFee: 0,
        total: 0
      } as any)
    )._id.toString();
  });

  afterAll(async () => {
    await disconnectMongo();
    await mongo.stop();
  });

  it('manual verify requires note and clears open order flags', async () => {
    const noNote = await request(app)
      .post(`/api/v1/admin/kyc/${rejectedUserId}/verify-manually`)
      .set('Authorization', `Bearer ${employeeAccessToken}`)
      .send({});
    expect(noNote.status).toBe(400);

    const ok = await request(app)
      .post(`/api/v1/admin/kyc/${rejectedUserId}/verify-manually`)
      .set('Authorization', `Bearer ${employeeAccessToken}`)
      .send({ note: 'ID received on WhatsApp and verified manually' });
    expect(ok.status).toBe(200);

    const user = await UserModel.findById(rejectedUserId).lean().exec();
    const order = await OrderModel.findById(rejectedOrderId).lean().exec();
    expect((user as any)?.kycStatus).toBe('verified');
    expect((order as any)?.deliveryAgeCheckRequired).toBe(false);
    expect((order as any)?.progressBlockedReason).toBeUndefined();
    expect((order as any)?.kycGateStatus).toBe('PASS');
  });

  it('age verification failed only works for OUT_FOR_DELIVERY and does not downgrade verified users', async () => {
    const invalidState = await request(app)
      .post(`/api/v1/admin/orders/${rejectedOrderId}/age-verification-failed`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ note: 'too early' });
    expect(invalidState.status).toBe(409);
    expect(invalidState.body.errorCode).toBe('AGE_VERIFICATION_ACTION_NOT_ALLOWED');

    const ok = await request(app)
      .post(`/api/v1/admin/orders/${verifiedOrderId}/age-verification-failed`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ note: 'Rider could not validate age at handover' });
    expect(ok.status).toBe(200);

    const user = await UserModel.findById(verifiedUserId).lean().exec();
    const order = await OrderModel.findById(verifiedOrderId).lean().exec();
    expect((user as any)?.kycStatus).toBe('verified');
    expect((order as any)?.status).toBe('CANCELLED');
    expect((order as any)?.progressBlockedReason).toBe('AGE_VERIFICATION_FAILED');
  });

  it('age verification failed downgrades non-verified users to rejected', async () => {
    const ok = await request(app)
      .post(`/api/v1/admin/orders/${pendingOrderId}/age-verification-failed`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ note: 'Customer refused to show ID' });
    expect(ok.status).toBe(200);

    const user = await UserModel.findById(pendingUserId).lean().exec();
    const order = await OrderModel.findById(pendingOrderId).lean().exec();
    expect((user as any)?.kycStatus).toBe('rejected');
    expect((user as any)?.kycRejectionReason).toBe('AGE_VERIFICATION_FAILED');
    expect((order as any)?.status).toBe('CANCELLED');
    expect((order as any)?.progressBlockedReason).toBe('AGE_VERIFICATION_FAILED');
  });
});
