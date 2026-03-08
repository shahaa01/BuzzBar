import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectMongo, disconnectMongo } from './config/mongo.js';
import { createApp } from './app.js';
import { AdminUserModel } from './modules/admin/admin.models.js';
import { hashPassword } from './modules/admin/admin.password.js';
import { UserModel } from './modules/user/user.models.js';
import { KycAttemptModel } from './modules/kyc/kyc.models.js';
import mongoose from 'mongoose';

describe('P2.2B KYC latest attempt deterministic', () => {
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

    await AdminUserModel.create({
      email: 'admin@buzzbar.com',
      passwordHash: await hashPassword('password12345'),
      role: 'admin',
      isActive: true
    });

    const login = await request(app).post('/api/v1/admin/auth/login').send({ email: 'admin@buzzbar.com', password: 'password12345' });
    expect(login.status).toBe(200);
    adminAccessToken = login.body.data.token as string;
    expect(adminAccessToken).toBeTruthy();
  });

  afterAll(async () => {
    await disconnectMongo();
    await mongo.stop();
  });

  it('GET /admin/kyc/:userId returns user.kycLastAttemptId attempt, not newest by date', async () => {
    const user = await UserModel.create({
      email: 'u1@buzzbar.com',
      passwordHash: 'x',
      emailVerified: true
    } as any);

    const requiredImage = {
      url: 'https://example.com/private.png',
      publicId: 'buzzbar/kyc/u1/a/front',
      format: 'png',
      width: 100,
      height: 100,
      size: 123,
      sha256: 'abc'
    };

    const attemptNewer = await KycAttemptModel.create({
      _id: new mongoose.Types.ObjectId(),
      userId: user._id,
      status: 'pending',
      submittedAt: new Date('2026-03-07T10:00:00.000Z'),
      idFront: requiredImage,
      autoDecision: 'needs_review',
      autoDecisionReason: 'low_confidence',
      clientDobSource: 'UNKNOWN',
      serverDobSource: 'UNKNOWN'
    } as any);

    const attemptOlderButLast = await KycAttemptModel.create({
      _id: new mongoose.Types.ObjectId(),
      userId: user._id,
      status: 'pending',
      submittedAt: new Date('2026-03-06T10:00:00.000Z'),
      idFront: requiredImage,
      autoDecision: 'needs_review',
      autoDecisionReason: 'dob_mismatch',
      clientDobSource: 'UNKNOWN',
      serverDobSource: 'UNKNOWN'
    } as any);

    user.kycLastAttemptId = attemptOlderButLast._id as any;
    await user.save();

    const res = await request(app)
      .get(`/api/v1/admin/kyc/${user._id.toString()}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.user.id || res.body.data.user._id).toBeTruthy();
    expect(res.body.data.attempt).toBeTruthy();
    expect(res.body.data.attempt._id).toBe(attemptOlderButLast._id.toString());
    expect(Array.isArray(res.body.data.attemptHistory)).toBe(true);
    expect(res.body.data.attemptHistory.length).toBe(2);
    expect(res.body.data.attemptHistory[0]._id).toBe(attemptNewer._id.toString());
  });
});

