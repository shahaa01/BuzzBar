import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectMongo, disconnectMongo } from './config/mongo.js';
import { createApp } from './app.js';
import { AdminUserModel, SettingsModel, SETTINGS_SINGLETON_ID } from './modules/admin/admin.models.js';
import { hashPassword } from './modules/admin/admin.password.js';
import { OrderModel } from './modules/orders/orders.models.js';
import { KycAttemptModel } from './modules/kyc/kyc.models.js';
import { PromotionModel } from './modules/promotions/promotions.models.js';
import { InventoryStockModel } from './modules/inventory/inventory.models.js';
import mongoose from 'mongoose';

describe('P2.2B Dashboard summary', () => {
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

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-07T12:00:00.000Z'));

    await SettingsModel.updateOne(
      { _id: SETTINGS_SINGLETON_ID },
      { $set: { _id: SETTINGS_SINGLETON_ID, nightHours: { start: '22:00', end: '06:00', timezone: 'Asia/Kathmandu' } } },
      { upsert: true }
    );

    await AdminUserModel.create({
      email: 'admin@buzzbar.com',
      passwordHash: await hashPassword('password12345'),
      role: 'admin',
      isActive: true
    });

    const login = await request(app).post('/api/v1/admin/auth/login').send({ email: 'admin@buzzbar.com', password: 'password12345' });
    expect(login.status).toBe(200);
    adminAccessToken = login.body.data.token as string;

    const uid = new mongoose.Types.ObjectId();

    // Orders: 2 today, 1 yesterday
    await OrderModel.create([
      {
        orderNumber: 'BB-2026-000010',
        userId: uid,
        status: 'CREATED',
        paymentMethod: 'COD',
        paymentStatus: 'UNPAID',
        kycGateStatus: 'PASS',
        kycStatusSnapshot: 'verified',
        addressSnapshot: { fullAddress: 'x', area: 'Kathmandu' },
        items: [],
        subtotal: 0,
        discount: 0,
        deliveryFee: 0,
        total: 0,
        createdAt: new Date('2026-03-07T00:30:00.000Z'),
        updatedAt: new Date('2026-03-07T00:30:00.000Z')
      },
      {
        orderNumber: 'BB-2026-000011',
        userId: uid,
        status: 'KYC_PENDING_REVIEW',
        paymentMethod: 'COD',
        paymentStatus: 'UNPAID',
        kycGateStatus: 'REVIEW_REQUIRED',
        kycStatusSnapshot: 'pending',
        addressSnapshot: { fullAddress: 'x', area: 'Kathmandu' },
        items: [],
        subtotal: 0,
        discount: 0,
        deliveryFee: 0,
        total: 0,
        createdAt: new Date('2026-03-07T05:00:00.000Z'),
        updatedAt: new Date('2026-03-07T05:00:00.000Z')
      },
      {
        orderNumber: 'BB-2026-000012',
        userId: uid,
        status: 'CANCELLED',
        paymentMethod: 'WALLET',
        paymentStatus: 'PENDING',
        kycGateStatus: 'PASS',
        kycStatusSnapshot: 'verified',
        addressSnapshot: { fullAddress: 'x', area: 'Kathmandu' },
        items: [],
        subtotal: 0,
        discount: 0,
        deliveryFee: 0,
        total: 0,
        createdAt: new Date('2026-03-06T10:00:00.000Z'),
        updatedAt: new Date('2026-03-06T10:00:00.000Z')
      }
    ] as any);

    // KYC attempts: 2 pending, 1 superseded
    const img = { url: 'https://x', publicId: 'p', size: 1, sha256: 's' };
    await KycAttemptModel.create([
      {
        _id: new mongoose.Types.ObjectId(),
        userId: uid,
        status: 'pending',
        submittedAt: new Date('2026-03-07T06:00:00.000Z'),
        idFront: img,
        autoDecision: 'needs_review',
        autoDecisionReason: 'low_confidence',
        clientDobSource: 'UNKNOWN',
        serverDobSource: 'UNKNOWN'
      },
      {
        _id: new mongoose.Types.ObjectId(),
        userId: uid,
        status: 'pending',
        submittedAt: new Date('2026-03-07T02:00:00.000Z'),
        idFront: img,
        autoDecision: 'needs_review',
        autoDecisionReason: 'dob_mismatch',
        clientDobSource: 'UNKNOWN',
        serverDobSource: 'UNKNOWN'
      },
      {
        _id: new mongoose.Types.ObjectId(),
        userId: uid,
        status: 'pending',
        submittedAt: new Date('2026-03-05T00:00:00.000Z'),
        supersededAt: new Date(),
        idFront: img,
        autoDecision: 'needs_review',
        autoDecisionReason: 'needs_review',
        clientDobSource: 'UNKNOWN',
        serverDobSource: 'UNKNOWN'
      }
    ] as any);

    // Promotions
    await PromotionModel.create([
      {
        code: 'ACTIVE10',
        type: 'PERCENT',
        value: 10,
        startAt: new Date('2026-03-01T00:00:00.000Z'),
        endAt: new Date('2026-03-30T00:00:00.000Z'),
        isActive: true
      },
      {
        code: 'INACTIVE',
        type: 'FLAT',
        value: 50,
        startAt: new Date('2026-03-01T00:00:00.000Z'),
        endAt: new Date('2026-03-30T00:00:00.000Z'),
        isActive: false
      }
    ] as any);

    // Inventory stocks
    await InventoryStockModel.create([
      { variantId: new mongoose.Types.ObjectId(), quantity: 3, reserved: 0 },
      { variantId: new mongoose.Types.ObjectId(), quantity: 10, reserved: 0 },
      { variantId: new mongoose.Types.ObjectId(), quantity: 0, reserved: 0 }
    ] as any);
  });

  afterAll(async () => {
    vi.useRealTimers();
    await disconnectMongo();
    await mongo.stop();
  });

  it('returns exact shape with correct counts', async () => {
    const res = await request(app)
      .get('/api/v1/admin/dashboard/summary?lowStockThreshold=5')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    const data = res.body.data;

    expect(data.timeZone).toBe('Asia/Kathmandu');
    expect(data.counts.ordersToday).toBe(2);
    expect(data.counts.ordersPendingReview).toBe(1);
    expect(data.counts.kycPending).toBe(2);
    expect(data.counts.promotionsActive).toBe(1);
    expect(data.counts.inventoryLowStock).toBe(2);
    expect(data.counts.inventoryZeroStock).toBe(1);
    expect(data.counts.walletPending).toBe(1);

    expect(data.inventory.lowStockThreshold).toBe(5);
    expect(typeof data.kycOldestPending.waitMinutes).toBe('number');
    expect(data.kycOldestPending.submittedAt).toBeTruthy();

    expect(data.statusBreakdown.ordersTodayByStatus.CREATED).toBe(1);
    expect(data.statusBreakdown.ordersTodayByStatus.KYC_PENDING_REVIEW).toBe(1);
  });
});
