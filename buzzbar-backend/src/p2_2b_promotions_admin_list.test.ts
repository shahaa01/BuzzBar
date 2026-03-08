import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectMongo, disconnectMongo } from './config/mongo.js';
import { createApp } from './app.js';
import { AdminUserModel } from './modules/admin/admin.models.js';
import { hashPassword } from './modules/admin/admin.password.js';
import { PromoUsageModel, PromotionModel } from './modules/promotions/promotions.models.js';

describe('Promotions admin list foundation', () => {
  let mongo: MongoMemoryServer;
  const app = createApp();
  let employeeAccessToken: string;
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

    await AdminUserModel.create([
      {
        email: 'employee@buzzbar.com',
        passwordHash: await hashPassword('password12345'),
        role: 'employee',
        isActive: true
      },
      {
        email: 'admin@buzzbar.com',
        passwordHash: await hashPassword('password12345'),
        role: 'admin',
        isActive: true
      }
    ]);

    const [employeeLogin, adminLogin] = await Promise.all([
      request(app).post('/api/v1/admin/auth/login').send({ email: 'employee@buzzbar.com', password: 'password12345' }),
      request(app).post('/api/v1/admin/auth/login').send({ email: 'admin@buzzbar.com', password: 'password12345' })
    ]);
    employeeAccessToken = employeeLogin.body.data.token as string;
    adminAccessToken = adminLogin.body.data.token as string;

    const [live, scheduled, expired, inactive] = await PromotionModel.create([
      {
        code: 'ACTIVE10',
        title: 'Weekend Launch',
        type: 'PERCENT',
        value: 10,
        startAt: new Date('2026-03-01T00:00:00.000Z'),
        endAt: new Date('2026-03-30T00:00:00.000Z'),
        isActive: true
      },
      {
        code: 'FUTURE50',
        title: 'Future Flat Promo',
        type: 'FLAT',
        value: 50,
        startAt: new Date('2026-04-01T00:00:00.000Z'),
        endAt: new Date('2026-04-30T00:00:00.000Z'),
        isActive: true
      },
      {
        code: 'OLD15',
        title: 'Expired Percent',
        type: 'PERCENT',
        value: 15,
        startAt: new Date('2026-02-01T00:00:00.000Z'),
        endAt: new Date('2026-02-15T00:00:00.000Z'),
        isActive: true
      },
      {
        code: 'SLEEPING',
        title: 'Manually disabled',
        type: 'FLAT',
        value: 200,
        startAt: new Date('2026-03-01T00:00:00.000Z'),
        endAt: new Date('2026-03-30T00:00:00.000Z'),
        isActive: false,
        usageLimitTotal: 5
      }
    ] as any);

    await PromoUsageModel.create([
      { promoId: live._id, userId: live._id, usedCount: 6 },
      { promoId: live._id, userId: scheduled._id, usedCount: 3 },
      { promoId: inactive._id, userId: expired._id, usedCount: 5 }
    ] as any);
  });

  afterAll(async () => {
    vi.useRealTimers();
    await disconnectMongo();
    await mongo.stop();
  });

  it('lists promotions for employee with enriched status, usage and filtering', async () => {
    const res = await request(app)
      .get('/api/v1/admin/promotions?state=live&type=PERCENT&sort=usageCount_desc&limit=20&page=1&q=launch')
      .set('Authorization', `Bearer ${employeeAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.items[0]).toMatchObject({
      code: 'ACTIVE10',
      title: 'Weekend Launch',
      status: 'live',
      type: 'PERCENT',
      usageCount: 9,
      isExhausted: false
    });
  });

  it('supports scheduled/inactive filters, date range filtering, and detail read', async () => {
    const scheduled = await request(app)
      .get('/api/v1/admin/promotions?state=scheduled&limit=20&page=1')
      .set('Authorization', `Bearer ${employeeAccessToken}`);
    expect(scheduled.status).toBe(200);
    expect(scheduled.body.data.items[0].code).toBe('FUTURE50');

    const inactive = await request(app)
      .get('/api/v1/admin/promotions?isActive=inactive&limit=20&page=1')
      .set('Authorization', `Bearer ${employeeAccessToken}`);
    expect(inactive.status).toBe(200);
    expect(inactive.body.data.items[0].status).toBe('inactive');
    expect(inactive.body.data.items[0].isExhausted).toBe(true);

    const dateFiltered = await request(app)
      .get('/api/v1/admin/promotions?from=2026-04-01&to=2026-04-30&limit=20&page=1')
      .set('Authorization', `Bearer ${employeeAccessToken}`);
    expect(dateFiltered.status).toBe(200);
    expect(dateFiltered.body.data.items.map((item: any) => item.code)).toContain('FUTURE50');

    const detail = await request(app)
      .get(`/api/v1/admin/promotions/${inactive.body.data.items[0].id}`)
      .set('Authorization', `Bearer ${employeeAccessToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.code).toBe('SLEEPING');
    expect(detail.body.data.usageCount).toBe(5);
  });

  it('allows admin to deactivate and rejects invalid limit', async () => {
    const list = await request(app)
      .get('/api/v1/admin/promotions?state=live&limit=20&page=1')
      .set('Authorization', `Bearer ${adminAccessToken}`);
    const liveId = list.body.data.items.find((item: any) => item.code === 'ACTIVE10').id as string;

    const deactivate = await request(app)
      .delete(`/api/v1/admin/promotions/${liveId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(deactivate.status).toBe(200);
    expect(deactivate.body.data.status).toBe('inactive');
    expect(deactivate.body.data.isActive).toBe(false);

    const invalidLimit = await request(app)
      .get('/api/v1/admin/promotions?limit=30&page=1')
      .set('Authorization', `Bearer ${employeeAccessToken}`);
    expect(invalidLimit.status).toBe(400);
  });
});
