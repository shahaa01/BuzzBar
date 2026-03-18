import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectMongo, disconnectMongo } from './config/mongo.js';
import { createApp } from './app.js';
import { AdminUserModel } from './modules/admin/admin.models.js';
import { hashPassword } from './modules/admin/admin.password.js';
import { decideKyc } from './modules/kyc/kyc.decision.js';

describe('P1.4 KYC', () => {
  let mongo: MongoMemoryServer;
  const app = createApp();
  let adminAccessToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';

    // Required secrets for JWT verification
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

    const login = await request(app)
      .post('/api/v1/admin/auth/login')
      .send({ email: 'admin@buzzbar.com', password: 'password12345' });
    expect(login.status).toBe(200);
    adminAccessToken = login.body.data.token;
    expect(adminAccessToken).toBeTruthy();
  });

  afterAll(async () => {
    await disconnectMongo();
    await mongo.stop();
  });

  it('Decision engine: AND gate + 90-day tolerance + never auto-reject', () => {
    const base = {
      legalAgeMin: 18,
      timezone: 'Asia/Kathmandu',
      evaluatedAt: new Date('2026-03-05T00:00:00.000Z'),
      confidenceThreshold: 0.7,
      dobToleranceDays: 90
    };

    const ok = decideKyc({
      ...base,
      client: { dobRaw: '2000-05-12', confidence: 0.95 },
      server: { ocrText: 'DOB 2000-04-20', confidence: 0.95 }
    });
    expect(ok.autoDecision).toBe('auto_verified');
    expect(ok.dobDifferenceDays).toBeLessThanOrEqual(90);

    const mismatch = decideKyc({
      ...base,
      client: { dobRaw: '2000-01-01', confidence: 0.95 },
      server: { ocrText: 'DOB 1999-01-01', confidence: 0.95 }
    });
    expect(mismatch.autoDecision).toBe('needs_review');

    const underage = decideKyc({
      ...base,
      client: { dobRaw: '2015-01-01', confidence: 0.95 },
      server: { ocrText: 'DOB 2015-01-01', confidence: 0.95 }
    });
    expect(underage.autoDecision).toBe('needs_review');
    expect(underage.autoDecisionReason).toContain('underage');

    const passportMonthName = decideKyc({
      ...base,
      client: { dobRaw: '20 JUN 1978', confidence: 0.95 },
      server: { ocrText: 'DATE OF BIRTH 1978 JUN 20', confidence: 0.95 }
    });
    expect(passportMonthName.autoDecision).toBe('auto_verified');
    expect(passportMonthName.clientParsed.dobAD?.toISOString()).toBe('1978-06-20T00:00:00.000Z');
    expect(passportMonthName.serverParsed.dobAD?.toISOString()).toBe('1978-06-20T00:00:00.000Z');

    const mixedScript = decideKyc({
      ...base,
      client: { dobRaw: 'DOB: २० JUN 1978', confidence: 0.95 },
      server: { ocrText: 'DOB 20 JUN 1978', confidence: 0.95 }
    });
    expect(mixedScript.autoDecision).toBe('auto_verified');
    expect(mixedScript.clientParsed.dobAD?.toISOString()).toBe('1978-06-20T00:00:00.000Z');
  });

  it('KYC submit: AND gate failure -> pending; status endpoint returns non-sensitive summary', async () => {
    const signup = await request(app)
      .post('/api/v1/auth/signup')
      .send({ email: 'u1@buzzbar.com', password: 'password123', name: 'User One' });
    expect(signup.status).toBe(201);
    const userToken = signup.body.data.token as string;
    expect(userToken).toBeTruthy();

    const submit = await request(app)
      .post('/api/v1/kyc/submit')
      .set('Authorization', `Bearer ${userToken}`)
      .field('clientDobRaw', '2000-08-01')
      .field('clientConfidence', '0.95')
      .attach('idFront', Buffer.from([0x89, 0x50, 0x4e, 0x47]), { filename: 'server-2000-01-01.png', contentType: 'image/png' });
    expect(submit.status).toBe(201);
    expect(submit.body.data.kycStatus).toBe('pending');
    expect(submit.body.data.autoDecision).toBe('needs_review');
    expect(submit.body.data.attemptId).toBeTruthy();
    expect(submit.body.data.attemptSummary.client.dobRaw).toBe('2000-08-01');
    expect(submit.body.data.attemptSummary.server.dobRaw).toBeTruthy();
    expect(submit.body.data.attemptSummary.interpretation.reviewRequired).toBe(true);
    expect(typeof submit.body.data.attemptSummary.interpretation.withinTolerance).toBe('boolean');

    const status = await request(app)
      .get('/api/v1/kyc/status')
      .set('Authorization', `Bearer ${userToken}`);
    expect(status.status).toBe(200);
    expect(status.body.data.kycStatus).toBe('pending');
    expect(status.body.data.lastAttemptId).toBeTruthy();
    expect(status.body.data.submittedAt).toBeTruthy();
    expect(status.body.data).not.toHaveProperty('idFront');
    expect(status.body.data).not.toHaveProperty('clientOcrText');
    expect(status.body.data.attemptSummary.server.ocrText).toBeTruthy();
    expect(status.body.data.attemptSummary.interpretation.reviewRequiredReason).toBeTruthy();
  });

  it('KYC submit: AND gate success -> auto verified', async () => {
    const signup = await request(app)
      .post('/api/v1/auth/signup')
      .send({ email: 'u2@buzzbar.com', password: 'password123', name: 'User Two' });
    expect(signup.status).toBe(201);
    const userToken = signup.body.data.token as string;

    const submit = await request(app)
      .post('/api/v1/kyc/submit')
      .set('Authorization', `Bearer ${userToken}`)
      .field('clientDobRaw', '2000-05-12')
      .field('clientConfidence', '0.95')
      .attach('idFront', Buffer.from([0x89, 0x50, 0x4e, 0x47]), { filename: 'server-2000-05-20.png', contentType: 'image/png' });
    expect(submit.status).toBe(201);
    expect(submit.body.data.kycStatus).toBe('verified');
    expect(submit.body.data.autoDecision).toBe('auto_verified');
    expect(submit.body.data.attemptSummary.interpretation.ageValid).toBe(true);
    expect(submit.body.data.attemptSummary.interpretation.reviewRequired).toBe(false);
  });

  it('Admin queue + approve/reject work', async () => {
    // Pending user to approve
    const signupA = await request(app)
      .post('/api/v1/auth/signup')
      .send({ email: 'u3@buzzbar.com', password: 'password123', name: 'User Three' });
    expect(signupA.status).toBe(201);
    const userAToken = signupA.body.data.token as string;
    const userAId = signupA.body.data.user.id as string;

    const submitA = await request(app)
      .post('/api/v1/kyc/submit')
      .set('Authorization', `Bearer ${userAToken}`)
      .field('clientDobRaw', '2000-08-01')
      .field('clientConfidence', '0.95')
      .attach('idFront', Buffer.from([0x89, 0x50, 0x4e, 0x47]), { filename: 'server-2000-01-01.png', contentType: 'image/png' });
    expect(submitA.status).toBe(201);
    expect(submitA.body.data.kycStatus).toBe('pending');

    const queue = await request(app)
      .get('/api/v1/admin/kyc/queue')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .query({ status: 'pending', page: 1, limit: 50 });
    expect(queue.status).toBe(200);
    const items = queue.body.data.items as any[];
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((i) => String(i.userId?._id ?? i.userId) === userAId)).toBe(true);

    const approve = await request(app)
      .post(`/api/v1/admin/kyc/${userAId}/approve`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({});
    expect(approve.status).toBe(200);

    const statusA = await request(app)
      .get('/api/v1/kyc/status')
      .set('Authorization', `Bearer ${userAToken}`);
    expect(statusA.status).toBe(200);
    expect(statusA.body.data.kycStatus).toBe('verified');

    // Pending user to reject
    const signupB = await request(app)
      .post('/api/v1/auth/signup')
      .send({ email: 'u4@buzzbar.com', password: 'password123', name: 'User Four' });
    expect(signupB.status).toBe(201);
    const userBToken = signupB.body.data.token as string;
    const userBId = signupB.body.data.user.id as string;

    const submitB = await request(app)
      .post('/api/v1/kyc/submit')
      .set('Authorization', `Bearer ${userBToken}`)
      .field('clientDobRaw', '2000-08-01')
      .field('clientConfidence', '0.95')
      .attach('idFront', Buffer.from([0x89, 0x50, 0x4e, 0x47]), { filename: 'server-2000-01-01.png', contentType: 'image/png' });
    expect(submitB.status).toBe(201);
    expect(submitB.body.data.kycStatus).toBe('pending');

    const reject = await request(app)
      .post(`/api/v1/admin/kyc/${userBId}/reject`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ reason: 'Blurry ID photo' });
    expect(reject.status).toBe(200);

    const statusB = await request(app)
      .get('/api/v1/kyc/status')
      .set('Authorization', `Bearer ${userBToken}`);
    expect(statusB.status).toBe(200);
    expect(statusB.body.data.kycStatus).toBe('rejected');
    expect(statusB.body.data.rejectionReason).toBe('Blurry ID photo');
  });
});
