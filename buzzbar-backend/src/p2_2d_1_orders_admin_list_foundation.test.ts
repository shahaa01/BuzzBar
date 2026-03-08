import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectMongo, disconnectMongo } from './config/mongo.js';
import { createApp } from './app.js';
import { AdminUserModel } from './modules/admin/admin.models.js';
import { hashPassword } from './modules/admin/admin.password.js';
import { UserModel } from './modules/user/user.models.js';
import { OrderModel } from './modules/orders/orders.models.js';

describe('P2.2D.1 admin orders list foundation', () => {
  let mongo: MongoMemoryServer;
  const app = createApp();
  let adminAccessToken: string;
  let employeeAdminId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ADMIN_JWT_ACCESS_SECRET = 'test_access_secret_1234567890';
    process.env.ADMIN_JWT_REFRESH_SECRET = 'test_refresh_secret_1234567890';
    process.env.USER_JWT_ACCESS_SECRET = 'test_user_access_secret_1234567890';
    process.env.USER_JWT_REFRESH_SECRET = 'test_user_refresh_secret_1234567890';

    mongo = await MongoMemoryServer.create();
    await connectMongo(mongo.getUri());

    const admin = await AdminUserModel.create({
      email: 'admin@buzzbar.com',
      passwordHash: await hashPassword('password12345'),
      role: 'admin',
      isActive: true
    });
    const employee = await AdminUserModel.create({
      email: 'employee@buzzbar.com',
      passwordHash: await hashPassword('password12345'),
      role: 'employee',
      isActive: true
    });
    employeeAdminId = employee._id.toString();

    const login = await request(app).post('/api/v1/admin/auth/login').send({ email: admin.email, password: 'password12345' });
    expect(login.status).toBe(200);
    adminAccessToken = login.body.data.token as string;

    const userA = await UserModel.create({
      email: 'a@buzzbar.com',
      name: 'Aaditya',
      phone: '9800000001',
      passwordHash: 'x',
      emailVerified: true,
      kycStatus: 'verified'
    } as any);
    const userB = await UserModel.create({
      email: 'b@buzzbar.com',
      name: 'Bina',
      phone: '9800000002',
      passwordHash: 'x',
      emailVerified: true,
      kycStatus: 'pending'
    } as any);

    await OrderModel.create([
      {
        orderNumber: 'BB-2026-000201',
        userId: userA._id,
        status: 'CONFIRMED',
        paymentMethod: 'COD',
        paymentStatus: 'UNPAID',
        kycGateStatus: 'PASS',
        kycStatusSnapshot: 'verified',
        addressSnapshot: { fullAddress: 'A1', area: 'Kathmandu' },
        items: [],
        subtotal: 1000,
        discount: 0,
        deliveryFee: 20,
        total: 1020,
        assignedToAdminId: employee._id,
        assignedAt: new Date('2026-03-05T10:00:00.000Z'),
        createdAt: new Date('2026-03-05T09:00:00.000Z'),
        updatedAt: new Date('2026-03-05T09:00:00.000Z')
      },
      {
        orderNumber: 'BB-2026-000202',
        userId: userB._id,
        status: 'KYC_PENDING_REVIEW',
        paymentMethod: 'WALLET',
        paymentStatus: 'PENDING',
        kycGateStatus: 'REVIEW_REQUIRED',
        kycStatusSnapshot: 'pending',
        addressSnapshot: { fullAddress: 'B1', area: 'Lalitpur' },
        items: [],
        subtotal: 2000,
        discount: 100,
        deliveryFee: 20,
        total: 1920,
        createdAt: new Date('2026-03-06T09:00:00.000Z'),
        updatedAt: new Date('2026-03-06T09:00:00.000Z')
      }
    ] as any);
  });

  afterAll(async () => {
    await disconnectMongo();
    await mongo.stop();
  });

  it('returns enriched rows and supports 2D.1 filters + assignee options', async () => {
    const list = await request(app)
      .get('/api/v1/admin/orders?page=1&limit=20&paymentMethod=WALLET&paymentStatus=PENDING&kycStatusSnapshot=pending&assigned=unassigned&serviceArea=Lalitpur&q=Bina')
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(list.status).toBe(200);
    expect(list.body.success).toBe(true);
    expect(list.body.data.total).toBe(1);

    const item = list.body.data.items[0];
    expect(item.orderNumber).toBe('BB-2026-000202');
    expect(item.paymentMethod).toBe('WALLET');
    expect(item.paymentStatus).toBe('PENDING');
    expect(item.kycStatusSnapshot).toBe('pending');
    expect(item.addressSnapshot.area).toBe('Lalitpur');
    expect(item.user.name).toBe('Bina');
    expect(item.assignedTo?.id ?? null).toBe(null);
    expect(item.quickActions.find((action: any) => action.to === 'CONFIRMED')?.allowed).toBe(false);

    const assigned = await request(app)
      .get(`/api/v1/admin/orders?page=1&limit=20&assigned=assigned&q=${encodeURIComponent('BB-2026-000201')}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(assigned.status).toBe(200);
    expect(assigned.body.data.total).toBe(1);
    expect(assigned.body.data.items[0].assignedTo.id).toBe(employeeAdminId);

    const assignees = await request(app).get('/api/v1/admin/orders/assignees').set('Authorization', `Bearer ${adminAccessToken}`);
    expect(assignees.status).toBe(200);
    expect(assignees.body.data.items.some((item: any) => item.id === employeeAdminId && item.email === 'employee@buzzbar.com')).toBe(true);
  });
});
