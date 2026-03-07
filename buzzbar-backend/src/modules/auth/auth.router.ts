import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { asyncHandler } from '../../common/utils/async_handler.js';
import { ApiError } from '../../common/middleware/error_handler.js';
import { sha256Base64Url, safeEqual } from '../admin/admin.crypto.js';
import { verifyPassword, hashPassword } from '../admin/admin.password.js';
import { UserModel, UserSessionModel } from '../user/user.models.js';
import { toUserPublic } from '../user/user.public.js';
import { signUserAccessToken, signUserRefreshToken, verifyUserRefreshToken } from './user.jwt.js';
import { verifyGoogleIdToken } from './oauth/google.js';
import { verifyAppleIdentityToken } from './oauth/apple.js';
import { authenticateUser } from './user.middleware.js';

function getRefreshTokenForRefresh(req: any) {
  const auth = (req.header('authorization') ?? '').toString();
  if (auth.startsWith('Bearer ')) return auth.slice('Bearer '.length).trim();
  const bodyToken = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken.trim() : '';
  return bodyToken;
}

function getRefreshTokenForLogout(req: any) {
  const hdr = (req.header('x-refresh-token') ?? '').toString().trim();
  if (hdr) return hdr;
  const bodyToken = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken.trim() : '';
  return bodyToken;
}

async function createSessionAndTokens(opts: { userId: string; ip?: string; userAgent?: string }) {
  const refreshDays = Number(process.env.USER_REFRESH_TOKEN_TTL_DAYS ?? '30');
  const expiresAt = new Date(Date.now() + refreshDays * 24 * 60 * 60 * 1000);
  const session = await UserSessionModel.create({
    userId: opts.userId,
    refreshTokenHash: `pending_${randomUUID()}`,
    expiresAt,
    ip: opts.ip,
    userAgent: opts.userAgent
  });

  const refreshToken = await signUserRefreshToken({ userId: opts.userId, sessionId: session._id.toString() });
  session.refreshTokenHash = sha256Base64Url(refreshToken);
  await session.save();

  const token = await signUserAccessToken({ userId: opts.userId });
  return { token, refreshToken, sessionId: session._id.toString() };
}

export function authRouter() {
  const router = Router();

  const bruteForceLimiter = rateLimit({
    windowMs: 60_000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test',
    handler(req, res) {
      res.status(429).json({
        success: false,
        message: 'Too many requests',
        errorCode: 'AUTH_RATE_LIMITED',
        requestId: (req as any).requestId
      });
    }
  });

  // Password signup/login (email is identifier only for password provider)
  router.post(
    '/signup',
    bruteForceLimiter,
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          email: z.string().email(),
          password: z.string().min(8),
          name: z.string().min(1).optional()
        })
        .parse(req.body);

      const email = body.email.toLowerCase().trim();
      const existing = await UserModel.findOne({ 'providers.password.email': email });
      if (existing) throw new ApiError(409, 'Email already registered', { errorCode: 'EMAIL_TAKEN' });

      const passwordHash = await hashPassword(body.password);
      const user = await UserModel.create({
        email,
        emailVerified: false,
        passwordHash,
        providers: { password: { email } },
        name: body.name,
        kycStatus: 'not_started'
      });

      const { token, refreshToken } = await createSessionAndTokens({
        userId: user._id.toString(),
        ip: req.ip,
        userAgent: req.header('user-agent')
      });

      res.status(201).json({
        success: true,
        data: { token, refreshToken, user: toUserPublic(user) }
      });
    })
  );

  router.post(
    '/login',
    bruteForceLimiter,
    asyncHandler(async (req, res) => {
      const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
      const email = body.email.toLowerCase().trim();

      const user = await UserModel.findOne({ 'providers.password.email': email });
      if (!user || !user.passwordHash) throw new ApiError(401, 'Invalid credentials', { errorCode: 'INVALID_CREDENTIALS' });

      const ok = await verifyPassword(body.password, user.passwordHash);
      if (!ok) throw new ApiError(401, 'Invalid credentials', { errorCode: 'INVALID_CREDENTIALS' });

      const { token, refreshToken } = await createSessionAndTokens({
        userId: user._id.toString(),
        ip: req.ip,
        userAgent: req.header('user-agent')
      });

      res.status(200).json({
        success: true,
        data: { token, refreshToken, user: toUserPublic(user) }
      });
    })
  );

  // OAuth provider logins (identity by provider sub, not email)
  router.post(
    '/google',
    asyncHandler(async (req, res) => {
      const body = z.object({ idToken: z.string().min(1) }).parse(req.body);
      const profile = await verifyGoogleIdToken(body.idToken);

      const existing = await UserModel.findOne({ 'providers.google.sub': profile.sub });
      const user =
        existing ??
        (await UserModel.create({
          providers: { google: { sub: profile.sub } },
          kycStatus: 'not_started'
        }));

      // Do not treat email as identity; only fill as profile/contact if present.
      if (!user.email && profile.email) user.email = profile.email.toLowerCase();
      if (profile.emailVerified !== undefined) user.emailVerified = profile.emailVerified;
      if (!user.name && profile.name) user.name = profile.name;
      if (!user.photoUrl && profile.picture) user.photoUrl = profile.picture;
      await user.save();

      const { token, refreshToken } = await createSessionAndTokens({
        userId: user._id.toString(),
        ip: req.ip,
        userAgent: req.header('user-agent')
      });

      res.status(200).json({ success: true, data: { token, refreshToken, user: toUserPublic(user) } });
    })
  );

  router.post(
    '/apple',
    asyncHandler(async (req, res) => {
      const body = z.object({ identityToken: z.string().min(1) }).parse(req.body);
      const profile = await verifyAppleIdentityToken(body.identityToken);

      const existing = await UserModel.findOne({ 'providers.apple.sub': profile.sub });
      const user =
        existing ??
        (await UserModel.create({
          providers: { apple: { sub: profile.sub } },
          kycStatus: 'not_started'
        }));

      if (!user.email && profile.email) user.email = profile.email.toLowerCase();
      if (profile.emailVerified !== undefined) user.emailVerified = profile.emailVerified;
      await user.save();

      const { token, refreshToken } = await createSessionAndTokens({
        userId: user._id.toString(),
        ip: req.ip,
        userAgent: req.header('user-agent')
      });

      res.status(200).json({ success: true, data: { token, refreshToken, user: toUserPublic(user) } });
    })
  );

  router.post(
    '/refresh',
    asyncHandler(async (req, res) => {
      const refreshToken = getRefreshTokenForRefresh(req);
      if (!refreshToken) throw new ApiError(401, 'Missing refresh token', { errorCode: 'UNAUTHORIZED' });

      let verified: { userId: string; sessionId: string };
      try {
        verified = await verifyUserRefreshToken(refreshToken);
      } catch {
        throw new ApiError(401, 'Invalid refresh token', { errorCode: 'UNAUTHORIZED' });
      }

      const session = await UserSessionModel.findById(verified.sessionId);
      if (!session || session.revokedAt) throw new ApiError(401, 'Invalid refresh token', { errorCode: 'UNAUTHORIZED' });
      if (session.userId.toString() !== verified.userId) throw new ApiError(401, 'Invalid refresh token', { errorCode: 'UNAUTHORIZED' });
      if (session.expiresAt.getTime() <= Date.now()) throw new ApiError(401, 'Invalid refresh token', { errorCode: 'UNAUTHORIZED' });

      const tokenHash = sha256Base64Url(refreshToken);
      if (!safeEqual(session.refreshTokenHash, tokenHash)) {
        throw new ApiError(401, 'Invalid refresh token', { errorCode: 'UNAUTHORIZED' });
      }

      const user = await UserModel.findById(verified.userId);
      if (!user) throw new ApiError(401, 'Invalid refresh token', { errorCode: 'UNAUTHORIZED' });

      // Rotate session
      const { token, refreshToken: newRefreshToken, sessionId: newSessionId } = await createSessionAndTokens({
        userId: user._id.toString(),
        ip: req.ip,
        userAgent: req.header('user-agent')
      });

      session.revokedAt = new Date();
      session.replacedBySessionId = newSessionId;
      await session.save();

      res.status(200).json({ success: true, data: { token, refreshToken: newRefreshToken } });
    })
  );

  router.post(
    '/logout',
    authenticateUser,
    asyncHandler(async (req, res) => {
      const refreshToken = getRefreshTokenForLogout(req);
      const userId = req.user!.id;

      if (refreshToken) {
        try {
          const verified = await verifyUserRefreshToken(refreshToken);
          if (verified.userId === userId) {
            const tokenHash = sha256Base64Url(refreshToken);
            await UserSessionModel.updateOne(
              { _id: verified.sessionId, userId, refreshTokenHash: tokenHash, revokedAt: { $exists: false } },
              { $set: { revokedAt: new Date() } }
            );
          }
        } catch {
          // ignore invalid refresh token
        }
      } else {
        await UserSessionModel.updateMany(
          { userId, revokedAt: { $exists: false } },
          { $set: { revokedAt: new Date() } }
        );
      }

      res.status(200).json({ success: true, data: { ok: true } });
    })
  );

  return router;
}
