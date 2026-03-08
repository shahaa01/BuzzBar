import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectMongo, disconnectMongo } from './config/mongo.js';
import { createApp } from './app.js';
import { AdminUserModel } from './modules/admin/admin.models.js';
import { hashPassword } from './modules/admin/admin.password.js';
import { OrderModel, OrderOperationAuditModel } from './modules/orders/orders.models.js';
import { UserModel } from './modules/user/user.models.js';

describe('Admin order assignment workflow', () => {
  let mongo: MongoMemoryServer;
  const app = createApp();
  let adminAccessToken: string;
  let employeeAccessToken: string;
  let operatorAId: string;
  let operatorBId: string;
  let orderId: string;

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
    operatorAId = (
      await AdminUserModel.create({
        email: 'operator-a@buzzbar.com',
        passwordHash: await hashPassword('password12345'),
        role: 'employee',
        isActive: true
      })
    )._id.toString();
    operatorBId = (
      await AdminUserModel.create({
        email: 'operator-b@buzzbar.com',
        passwordHash: await hashPassword('password12345'),
        role: 'employee',
        isActive: true
      })
    )._id.toString();

    const adminLogin = await request(app).post('/api/v1/admin/auth/login').send({ email: admin.email, password: 'password12345' });
    adminAccessToken = adminLogin.body.data.token as string;

    const employeeLogin = await request(app).post('/api/v1/admin/auth/login').send({ email: employee.email, password: 'password12345' });
    employeeAccessToken = employeeLogin.body.data.token as string;

    const user = await UserModel.create({
      email: 'buyer@buzzbar.com',
      passwordHash: 'x',
      emailVerified: true,
      kycStatus: 'verified'
    } as any);

    orderId = (
      await OrderModel.create({
        orderNumber: 'BB-2026-000801',
        userId: user._id,
        status: 'CONFIRMED',
        paymentMethod: 'COD',
        paymentStatus: 'UNPAID',
        kycGateStatus: 'PASS',
        kycStatusSnapshot: 'verified',
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

  it('blocks employee from assignment endpoints', async () => {
    const assignees = await request(app).get('/api/v1/admin/orders/assignees').set('Authorization', `Bearer ${employeeAccessToken}`);
    expect(assignees.status).toBe(403);

    const assign = await request(app)
      .patch(`/api/v1/admin/orders/${orderId}/assign`)
      .set('Authorization', `Bearer ${employeeAccessToken}`)
      .send({ assignedToAdminId: operatorAId });
    expect(assign.status).toBe(403);
  });

  it('assigns, reassigns, unassigns and records assignment audit', async () => {
    const assign = await request(app)
      .patch(`/api/v1/admin/orders/${orderId}/assign`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ assignedToAdminId: operatorAId });
    expect(assign.status).toBe(200);

    const reassigned = await request(app)
      .patch(`/api/v1/admin/orders/${orderId}/assign`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ assignedToAdminId: operatorBId });
    expect(reassigned.status).toBe(200);

    const unassign = await request(app)
      .post(`/api/v1/admin/orders/${orderId}/unassign`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(unassign.status).toBe(200);

    const order = await OrderModel.findById(orderId).lean().exec();
    expect((order as any)?.assignedToAdminId ?? null).toBe(null);

    const audits = await OrderOperationAuditModel.find({ orderId, type: 'ASSIGNMENT' }).sort({ createdAt: 1 }).lean().exec();
    expect(audits).toHaveLength(3);
    expect((audits[0] as any).actionId).toBe('ASSIGN');
    expect((audits[1] as any).actionId).toBe('REASSIGN');
    expect((audits[2] as any).actionId).toBe('UNASSIGN');

    const detail = await request(app).get(`/api/v1/admin/orders/${orderId}`).set('Authorization', `Bearer ${adminAccessToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.assignment.history).toHaveLength(3);
    expect(detail.body.data.assignment.history[0].actionId).toBe('UNASSIGN');
  });
});
