import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../common/utils/async_handler.js';
import { ApiError } from '../../common/middleware/error_handler.js';
import { authenticateAdmin, requireAdminRole } from '../admin/admin.middleware.js';
import { AdminAuditLogModel } from '../admin/admin.models.js';
import { KycAttemptModel } from './kyc.models.js';
import { UserModel } from '../user/user.models.js';
import { CloudinaryNotConfiguredError, getSignedPrivateDownloadUrl } from '../uploads/cloudinary.service.js';
import { cancelOrdersForKycRejected } from '../orders/orders.service.js';

const REVIEW_ROLES = ['superadmin', 'admin', 'employee'] as const;

function signKycUrl(img: any) {
  if (!img?.publicId) return img;
  const format = String(img.format ?? 'png');
  const expiresAtUnixSec = Math.floor(Date.now() / 1000) + 5 * 60;
  try {
    const url = getSignedPrivateDownloadUrl({ publicId: String(img.publicId), format, expiresAtUnixSec });
    return { ...img, url };
  } catch (e) {
    if (e instanceof CloudinaryNotConfiguredError) return img;
    return img;
  }
}

export function kycAdminRouter() {
  const router = Router();

  router.get(
    '/kyc/queue',
    authenticateAdmin,
    requireAdminRole([...REVIEW_ROLES]),
    asyncHandler(async (req, res) => {
      const query = z
        .object({
          status: z.enum(['pending', 'verified', 'rejected']).default('pending'),
          page: z.coerce.number().int().positive().default(1),
          limit: z.coerce.number().int().positive().max(100).default(20)
        })
        .parse(req.query ?? {});

      const skip = (query.page - 1) * query.limit;
      const filter: any = { status: query.status };
      if (query.status === 'pending') filter.supersededAt = { $exists: false };

      const [items, total] = await Promise.all([
        KycAttemptModel.find(filter)
          .select({
            idFront: 0,
            idBack: 0,
            selfie: 0,
            clientOcrText: 0,
            serverOcrText: 0
          })
          .sort({ submittedAt: -1 })
          .skip(skip)
          .limit(query.limit)
          .populate('userId', { email: 1, phone: 1, name: 1, kycStatus: 1 })
          .lean(),
        KycAttemptModel.countDocuments(filter)
      ]);

      res.status(200).json({
        success: true,
        data: {
          items,
          page: query.page,
          limit: query.limit,
          total
        }
      });
    })
  );

  router.get(
    '/kyc/:userId',
    authenticateAdmin,
    requireAdminRole([...REVIEW_ROLES]),
    asyncHandler(async (req, res) => {
      const params = z.object({ userId: z.string().min(1) }).parse(req.params);

      const user = await UserModel.findById(params.userId)
        .select({
          email: 1,
          phone: 1,
          name: 1,
          kycStatus: 1,
          kycVerifiedAt: 1,
          kycLastAttemptId: 1,
          kycRejectedAt: 1,
          kycRejectionReason: 1,
          createdAt: 1,
          updatedAt: 1
        })
        .exec();
      if (!user) throw new ApiError(404, 'User not found', { errorCode: 'NOT_FOUND' });

      const attemptDoc = await KycAttemptModel.findOne({ userId: user._id }).sort({ submittedAt: -1 }).exec();
      const attempt = attemptDoc ? (attemptDoc.toObject() as any) : null;
      if (attempt) {
        attempt.idFront = signKycUrl(attempt.idFront);
        attempt.idBack = signKycUrl(attempt.idBack);
        attempt.selfie = signKycUrl(attempt.selfie);
      }

      res.status(200).json({
        success: true,
        data: { user, attempt }
      });
    })
  );

  router.post(
    '/kyc/:userId/approve',
    authenticateAdmin,
    requireAdminRole([...REVIEW_ROLES]),
    asyncHandler(async (req, res) => {
      const params = z.object({ userId: z.string().min(1) }).parse(req.params);
      const user = await UserModel.findById(params.userId);
      if (!user) throw new ApiError(404, 'User not found', { errorCode: 'NOT_FOUND' });

      const attemptId = user.kycLastAttemptId?.toString?.();
      if (!attemptId) throw new ApiError(409, 'No KYC attempt to approve', { errorCode: 'KYC_NO_ATTEMPT' });

      const attempt = await KycAttemptModel.findById(attemptId);
      if (!attempt || attempt.userId.toString() !== user._id.toString()) {
        throw new ApiError(409, 'Invalid KYC attempt', { errorCode: 'KYC_INVALID_ATTEMPT' });
      }
      if (attempt.status !== 'pending') {
        throw new ApiError(409, 'KYC attempt already reviewed', { errorCode: 'KYC_ALREADY_REVIEWED' });
      }

      const before = { kycStatus: user.kycStatus, kycVerifiedAt: user.kycVerifiedAt, kycRejectedAt: user.kycRejectedAt, kycRejectionReason: user.kycRejectionReason };

      attempt.status = 'verified';
      attempt.reviewedAt = new Date();
      attempt.reviewedByAdminId = req.admin!.id as any;
      attempt.reviewDecision = 'approved';
      attempt.reviewReason = undefined;
      await attempt.save();

      user.kycStatus = 'verified';
      user.kycVerifiedAt = new Date();
      user.kycRejectedAt = undefined;
      user.kycRejectionReason = undefined;
      await user.save();

      await AdminAuditLogModel.create({
        adminId: req.admin!.id,
        action: 'kyc.approve',
        entityType: 'user',
        entityId: user._id.toString(),
        before,
        after: { kycStatus: user.kycStatus, kycVerifiedAt: user.kycVerifiedAt },
        meta: { ip: req.ip, userAgent: req.header('user-agent'), requestId: req.requestId, attemptId: attempt._id.toString() }
      });

      res.status(200).json({ success: true, data: { ok: true, userId: user._id.toString(), attemptId: attempt._id.toString() } });
    })
  );

  router.post(
    '/kyc/:userId/reject',
    authenticateAdmin,
    requireAdminRole([...REVIEW_ROLES]),
    asyncHandler(async (req, res) => {
      const params = z.object({ userId: z.string().min(1) }).parse(req.params);
      const body = z.object({ reason: z.string().min(1).max(500) }).parse(req.body ?? {});

      const user = await UserModel.findById(params.userId);
      if (!user) throw new ApiError(404, 'User not found', { errorCode: 'NOT_FOUND' });

      const attemptId = user.kycLastAttemptId?.toString?.();
      if (!attemptId) throw new ApiError(409, 'No KYC attempt to reject', { errorCode: 'KYC_NO_ATTEMPT' });

      const attempt = await KycAttemptModel.findById(attemptId);
      if (!attempt || attempt.userId.toString() !== user._id.toString()) {
        throw new ApiError(409, 'Invalid KYC attempt', { errorCode: 'KYC_INVALID_ATTEMPT' });
      }
      if (attempt.status !== 'pending') {
        throw new ApiError(409, 'KYC attempt already reviewed', { errorCode: 'KYC_ALREADY_REVIEWED' });
      }

      const before = { kycStatus: user.kycStatus, kycVerifiedAt: user.kycVerifiedAt, kycRejectedAt: user.kycRejectedAt, kycRejectionReason: user.kycRejectionReason };

      attempt.status = 'rejected';
      attempt.reviewedAt = new Date();
      attempt.reviewedByAdminId = req.admin!.id as any;
      attempt.reviewDecision = 'rejected';
      attempt.reviewReason = body.reason;
      await attempt.save();

      user.kycStatus = 'rejected';
      user.kycVerifiedAt = undefined;
      user.kycRejectedAt = new Date();
      user.kycRejectionReason = body.reason;
      await user.save();

      await cancelOrdersForKycRejected({ userId: user._id.toString(), reason: `kyc_rejected:${body.reason}` });

      await AdminAuditLogModel.create({
        adminId: req.admin!.id,
        action: 'kyc.reject',
        entityType: 'user',
        entityId: user._id.toString(),
        before,
        after: { kycStatus: user.kycStatus, kycRejectedAt: user.kycRejectedAt, kycRejectionReason: user.kycRejectionReason },
        meta: { ip: req.ip, userAgent: req.header('user-agent'), requestId: req.requestId, attemptId: attempt._id.toString() }
      });

      res.status(200).json({ success: true, data: { ok: true, userId: user._id.toString(), attemptId: attempt._id.toString() } });
    })
  );

  return router;
}
