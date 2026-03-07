import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { SignJWT } from 'jose';
import { connectMongo, disconnectMongo } from './config/mongo.js';
import { createApp } from './app.js';

describe('P1.2 user auth (multi-provider + sessions)', () => {
  let mongo: MongoMemoryServer;
  const app = createApp();

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';

    // Admin env (required by env schema when running server, but router tests don't call getEnv)
    process.env.ADMIN_JWT_ACCESS_SECRET = 'test_access_secret_1234567890';
    process.env.ADMIN_JWT_REFRESH_SECRET = 'test_refresh_secret_1234567890';

    // User JWT
    process.env.USER_JWT_ACCESS_SECRET = 'test_user_access_secret_1234567890';
    process.env.USER_JWT_REFRESH_SECRET = 'test_user_refresh_secret_1234567890';
    process.env.USER_ACCESS_TOKEN_TTL_MIN = '15';
    process.env.USER_REFRESH_TOKEN_TTL_DAYS = '30';

    // OAuth test-mode
    process.env.OAUTH_MODE = 'test';
    process.env.OAUTH_TEST_SECRET = 'oauth_test_secret_1234567890';
    process.env.GOOGLE_OAUTH_CLIENT_IDS = 'google-client-1';
    process.env.APPLE_CLIENT_IDS = 'apple-client-1';

    mongo = await MongoMemoryServer.create();
    await connectMongo(mongo.getUri());
  });

  afterAll(async () => {
    await disconnectMongo();
    await mongo.stop();
  });

  it('refresh rotation invalidates old token; logout revokes session', async () => {
    const signup = await request(app)
      .post('/api/v1/auth/signup')
      .send({ email: 'user@buzzbar.com', password: 'password12345', name: 'User One' });
    expect(signup.status).toBe(201);
    const access1 = signup.body.data.token as string;
    const refresh1 = signup.body.data.refreshToken as string;
    expect(access1).toBeTruthy();
    expect(refresh1).toBeTruthy();
    expect(signup.body.data.user.kycStatus).toBe('not_started');

    const me = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${access1}`);
    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe('user@buzzbar.com');

    const refreshed = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Authorization', `Bearer ${refresh1}`)
      .send({});
    expect(refreshed.status).toBe(200);
    const access2 = refreshed.body.data.token as string;
    const refresh2 = refreshed.body.data.refreshToken as string;
    expect(access2).toBeTruthy();
    expect(refresh2).toBeTruthy();

    const oldRefresh = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Authorization', `Bearer ${refresh1}`)
      .send({});
    expect(oldRefresh.status).toBe(401);

    const logout = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${access2}`)
      .set('x-refresh-token', refresh2)
      .send({});
    expect(logout.status).toBe(200);

    const afterLogout = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Authorization', `Bearer ${refresh2}`)
      .send({});
    expect(afterLogout.status).toBe(401);
  });

  async function signTestIdToken(opts: {
    iss: string;
    aud: string;
    sub: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
  }) {
    const secret = new TextEncoder().encode(process.env.OAUTH_TEST_SECRET!);
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({
      iss: opts.iss,
      email: opts.email,
      email_verified: opts.email_verified,
      name: opts.name,
      picture: opts.picture
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setAudience(opts.aud)
      .setSubject(opts.sub)
      .setIssuedAt(now)
      .setExpirationTime(now + 600)
      .sign(secret);
  }

  it('provider login matches by sub (not by email)', async () => {
    const googleToken1 = await signTestIdToken({
      iss: 'https://accounts.google.com',
      aud: 'google-client-1',
      sub: 'google-sub-123',
      email: 'g1@example.com',
      email_verified: true,
      name: 'G One',
      picture: 'https://example.com/p.png'
    });

    const login1 = await request(app).post('/api/v1/auth/google').send({ idToken: googleToken1 });
    expect(login1.status).toBe(200);
    const userId1 = login1.body.data.user.id as string;
    expect(userId1).toBeTruthy();
    expect(login1.body.data.user.email).toBe('g1@example.com');

    // Same sub, different email => should return same user (email not identity)
    const googleToken2 = await signTestIdToken({
      iss: 'https://accounts.google.com',
      aud: 'google-client-1',
      sub: 'google-sub-123',
      email: 'changed@example.com',
      email_verified: true
    });
    const login2 = await request(app).post('/api/v1/auth/google').send({ idToken: googleToken2 });
    expect(login2.status).toBe(200);
    expect(login2.body.data.user.id).toBe(userId1);
    expect(login2.body.data.user.email).toBe('g1@example.com'); // we do not overwrite existing email

    // Same email, different sub => must create a different user
    const appleToken = await signTestIdToken({
      iss: 'https://appleid.apple.com',
      aud: 'apple-client-1',
      sub: 'apple-sub-999',
      email: 'g1@example.com',
      email_verified: true
    });
    const appleLogin = await request(app).post('/api/v1/auth/apple').send({ identityToken: appleToken });
    expect(appleLogin.status).toBe(200);
    expect(appleLogin.body.data.user.id).not.toBe(userId1);
  });
});

