import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../common/utils/async_handler.js';
import { ApiError } from '../../common/middleware/error_handler.js';
import rateLimit from 'express-rate-limit';
import { AdminAuditLogModel, AdminSessionModel, AdminUserModel, SETTINGS_SINGLETON_ID, SettingsModel } from './admin.models.js';
import { authenticateAdmin, requireAdminRole } from './admin.middleware.js';
import { sha256Base64Url } from './admin.crypto.js';
import { signAdminAccessToken, signAdminRefreshToken, verifyAdminRefreshToken } from './admin.jwt.js';
import { verifyPassword } from './admin.password.js';
import type { AdminPublic } from './admin.types.js';
import { randomUUID } from 'node:crypto';
import { todayRangeUtc } from '../../common/utils/timezone.js';
import { OrderModel } from '../orders/orders.models.js';
import { KycAttemptModel } from '../kyc/kyc.models.js';
import { InventoryStockModel } from '../inventory/inventory.models.js';
import { PromotionModel } from '../promotions/promotions.models.js';

function toAdminPublic(doc: any): AdminPublic {
  return {
    id: doc._id.toString(),
    email: doc.email,
    role: doc.role,
    isActive: doc.isActive
  };
}

async function ensureSettings() {
  await SettingsModel.updateOne(
    { _id: SETTINGS_SINGLETON_ID },
    { $setOnInsert: { _id: SETTINGS_SINGLETON_ID } },
    { upsert: true }
  );
  return SettingsModel.findById(SETTINGS_SINGLETON_ID).lean();
}

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

export function adminRouter() {
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
        errorCode: 'ADMIN_AUTH_RATE_LIMITED',
        requestId: (req as any).requestId
      });
    }
  });

  // ---- Admin Auth
  router.post(
    '/auth/login',
    bruteForceLimiter,
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          email: z.string().email(),
          password: z.string().min(1)
        })
        .parse(req.body);

      const admin = await AdminUserModel.findOne({ email: body.email.toLowerCase().trim() });
      if (!admin || !admin.isActive) {
        throw new ApiError(401, 'Invalid credentials', { errorCode: 'ADMIN_INVALID_CREDENTIALS' });
      }

      const ok = await verifyPassword(body.password, admin.passwordHash);
      if (!ok) {
        throw new ApiError(401, 'Invalid credentials', { errorCode: 'ADMIN_INVALID_CREDENTIALS' });
      }

      const refreshDays = Number(process.env.ADMIN_REFRESH_TOKEN_TTL_DAYS ?? '30');
      const expiresAt = new Date(Date.now() + refreshDays * 24 * 60 * 60 * 1000);
      const session = await AdminSessionModel.create({
        adminId: admin._id,
        tokenHash: `pending_${randomUUID()}`,
        expiresAt,
        ip: req.ip,
        userAgent: req.header('user-agent')
      });

      const refreshToken = await signAdminRefreshToken({ adminId: admin._id.toString(), sessionId: session._id.toString() });
      session.tokenHash = sha256Base64Url(refreshToken);
      await session.save();

      const token = await signAdminAccessToken({ adminId: admin._id.toString(), role: admin.role });

      res.status(200).json({
        success: true,
        data: {
          token,
          refreshToken,
          admin: toAdminPublic(admin)
        }
      });
    })
  );

  router.post(
    '/auth/refresh',
    asyncHandler(async (req, res) => {
      const refreshToken = getRefreshTokenForRefresh(req);
      if (!refreshToken) {
        throw new ApiError(401, 'Missing refresh token', { errorCode: 'ADMIN_UNAUTHORIZED' });
      }

      let verified: { adminId: string; sessionId: string };
      try {
        verified = await verifyAdminRefreshToken(refreshToken);
      } catch {
        throw new ApiError(401, 'Invalid refresh token', { errorCode: 'ADMIN_UNAUTHORIZED' });
      }

      const session = await AdminSessionModel.findById(verified.sessionId);
      if (!session || session.revokedAt) {
        throw new ApiError(401, 'Invalid refresh token', { errorCode: 'ADMIN_UNAUTHORIZED' });
      }
      if (session.adminId.toString() !== verified.adminId) {
        throw new ApiError(401, 'Invalid refresh token', { errorCode: 'ADMIN_UNAUTHORIZED' });
      }
      if (session.expiresAt.getTime() <= Date.now()) {
        throw new ApiError(401, 'Invalid refresh token', { errorCode: 'ADMIN_UNAUTHORIZED' });
      }

      const tokenHash = sha256Base64Url(refreshToken);
      if (session.tokenHash !== tokenHash) {
        throw new ApiError(401, 'Invalid refresh token', { errorCode: 'ADMIN_UNAUTHORIZED' });
      }

      const admin = await AdminUserModel.findById(verified.adminId);
      if (!admin || !admin.isActive) {
        throw new ApiError(401, 'Invalid refresh token', { errorCode: 'ADMIN_UNAUTHORIZED' });
      }

      // Rotate session
      const refreshDays = Number(process.env.ADMIN_REFRESH_TOKEN_TTL_DAYS ?? '30');
      const expiresAt = new Date(Date.now() + refreshDays * 24 * 60 * 60 * 1000);
      const newSession = await AdminSessionModel.create({
        adminId: admin._id,
        tokenHash: `pending_${randomUUID()}`,
        expiresAt,
        ip: req.ip,
        userAgent: req.header('user-agent')
      });

      const newRefreshToken = await signAdminRefreshToken({ adminId: admin._id.toString(), sessionId: newSession._id.toString() });
      newSession.tokenHash = sha256Base64Url(newRefreshToken);
      await newSession.save();

      session.revokedAt = new Date();
      session.replacedBySessionId = newSession._id;
      await session.save();

      const token = await signAdminAccessToken({ adminId: admin._id.toString(), role: admin.role });

      res.status(200).json({
        success: true,
        data: {
          token,
          refreshToken: newRefreshToken
        }
      });
    })
  );

  router.post(
    '/auth/logout',
    authenticateAdmin,
    asyncHandler(async (req, res) => {
      const refreshToken = getRefreshTokenForLogout(req);
      const adminId = req.admin!.id;

      if (refreshToken) {
        // Revoke a single session if token matches
        try {
          const verified = await verifyAdminRefreshToken(refreshToken);
          if (verified.adminId === adminId) {
            const tokenHash = sha256Base64Url(refreshToken);
            await AdminSessionModel.updateOne(
              { _id: verified.sessionId, adminId, tokenHash, revokedAt: { $exists: false } },
              { $set: { revokedAt: new Date() } }
            );
          }
        } catch {
          // Intentionally ignore invalid refresh token on logout
        }
      } else {
        // Revoke all active sessions for admin
        await AdminSessionModel.updateMany(
          { adminId, revokedAt: { $exists: false } },
          { $set: { revokedAt: new Date() } }
        );
      }

      res.status(200).json({ success: true, data: { ok: true } });
    })
  );

  // ---- Settings
  router.get(
    '/dashboard/summary',
    authenticateAdmin,
    requireAdminRole(['superadmin', 'admin']),
    asyncHandler(async (req, res) => {
      const query = z
        .object({
          lowStockThreshold: z.coerce.number().int().min(0).default(5)
        })
        .parse(req.query ?? {});

      const settings = await ensureSettings();
      const timeZone = String((settings as any)?.nightHours?.timezone ?? 'Asia/Kathmandu');

      const now = new Date();
      const { start, end } = todayRangeUtc({ now, timeZone });

      const orderStatuses = [
        'CREATED',
        'KYC_PENDING_REVIEW',
        'CONFIRMED',
        'PACKING',
        'READY_FOR_DISPATCH',
        'OUT_FOR_DELIVERY',
        'DELIVERED',
        'CANCELLED'
      ] as const;

      const [ordersToday, ordersPendingReview, ordersTodayByStatusAgg, ordersBacklogByStatusAgg] = await Promise.all([
        OrderModel.countDocuments({ createdAt: { $gte: start, $lt: end } }),
        OrderModel.countDocuments({ status: 'KYC_PENDING_REVIEW' }),
        OrderModel.aggregate([
          { $match: { createdAt: { $gte: start, $lt: end } } },
          { $group: { _id: '$status', count: { $sum: 1 } } }
        ]),
        OrderModel.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }])
      ]);

      const ordersTodayByStatus: Record<string, number> = Object.fromEntries(orderStatuses.map((s) => [s, 0]));
      for (const row of ordersTodayByStatusAgg as any[]) {
        if (row?._id && typeof row.count === 'number') ordersTodayByStatus[String(row._id)] = row.count;
      }

      const ordersBacklogByStatus: Record<string, number> = Object.fromEntries(orderStatuses.map((s) => [s, 0]));
      for (const row of ordersBacklogByStatusAgg as any[]) {
        if (row?._id && typeof row.count === 'number') ordersBacklogByStatus[String(row._id)] = row.count;
      }

      const kycPendingFilter: any = { status: 'pending', supersededAt: { $exists: false } };
      const [kycPending, oldestPendingAttempt] = await Promise.all([
        KycAttemptModel.countDocuments(kycPendingFilter),
        KycAttemptModel.findOne(kycPendingFilter).sort({ submittedAt: 1 }).select({ submittedAt: 1 }).lean()
      ]);

      const oldestSubmittedAt = (oldestPendingAttempt as any)?.submittedAt ? new Date((oldestPendingAttempt as any).submittedAt) : null;
      const waitMinutes = oldestSubmittedAt ? Math.max(0, Math.floor((now.getTime() - oldestSubmittedAt.getTime()) / 60_000)) : undefined;

      const [promotionsActive, inventoryLowStock, inventoryZeroStock, walletPending] = await Promise.all([
        PromotionModel.countDocuments({ isActive: true, startAt: { $lte: now }, endAt: { $gte: now } }),
        InventoryStockModel.countDocuments({ quantity: { $lte: query.lowStockThreshold } }),
        InventoryStockModel.countDocuments({ quantity: { $lte: 0 } }),
        OrderModel.countDocuments({ paymentMethod: 'WALLET', paymentStatus: 'PENDING' })
      ]);

      res.status(200).json({
        success: true,
        data: {
          generatedAt: new Date().toISOString(),
          timeZone,
          counts: {
            ordersToday,
            ordersPendingReview,
            kycPending,
            promotionsActive,
            inventoryLowStock,
            inventoryZeroStock,
            walletPending
          },
          statusBreakdown: {
            ordersTodayByStatus,
            ordersBacklogByStatus
          },
          kycOldestPending: {
            submittedAt: oldestSubmittedAt ? oldestSubmittedAt.toISOString() : undefined,
            waitMinutes
          },
          inventory: {
            lowStockThreshold: query.lowStockThreshold
          }
        }
      });
    })
  );

  router.get(
    '/settings',
    authenticateAdmin,
    requireAdminRole(['superadmin', 'admin']),
    asyncHandler(async (_req, res) => {
      const settings = await ensureSettings();
      res.status(200).json({ success: true, data: settings });
    })
  );

  router.put(
    '/settings',
    authenticateAdmin,
    requireAdminRole(['superadmin']),
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          nightHours: z
            .object({
              start: z.string().regex(/^\d{2}:\d{2}$/),
              end: z.string().regex(/^\d{2}:\d{2}$/),
              timezone: z.string().min(1).default('Asia/Kathmandu')
            })
            .optional(),
          serviceAreas: z.array(z.string().min(1)).optional(),
          deliveryFeeFlat: z.number().min(0).optional(),
          legalAgeMin: z.number().int().min(1).max(120).optional()
        })
        .parse(req.body);

      const before = await ensureSettings();

      const update: any = {};
      if (body.nightHours) update.nightHours = body.nightHours;
      if (body.serviceAreas) update.serviceAreas = body.serviceAreas;
      if (typeof body.deliveryFeeFlat === 'number') update.deliveryFeeFlat = body.deliveryFeeFlat;
      if (typeof body.legalAgeMin === 'number') update.legalAgeMin = body.legalAgeMin;

      const after = await SettingsModel.findByIdAndUpdate(
        SETTINGS_SINGLETON_ID,
        { $set: update },
        { new: true, lean: true }
      );

      await AdminAuditLogModel.create({
        adminId: req.admin!.id,
        action: 'settings.update',
        entityType: 'settings',
        entityId: SETTINGS_SINGLETON_ID,
        before,
        after,
        meta: { ip: req.ip, userAgent: req.header('user-agent'), requestId: req.requestId }
      });

      res.status(200).json({ success: true, data: after });
    })
  );

  return router;
}
