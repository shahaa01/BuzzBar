import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { asyncHandler } from '../../common/utils/async_handler.js';
import { ApiError } from '../../common/middleware/error_handler.js';
import { authenticateUser } from '../auth/user.middleware.js';
import { CloudinaryNotConfiguredError } from '../uploads/cloudinary.service.js';
import { submitKycAttempt, KYC_ALLOWED_MIME, MAX_KYC_FILE_SIZE_BYTES } from './kyc.service.js';
import { UserModel } from '../user/user.models.js';
import { KycAttemptModel } from './kyc.models.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_KYC_FILE_SIZE_BYTES },
  fileFilter(_req, file, cb) {
    if (!KYC_ALLOWED_MIME.has(file.mimetype)) {
      return cb(new ApiError(400, 'Unsupported file type', { errorCode: 'KYC_UNSUPPORTED_MIME' }));
    }
    return cb(null, true);
  }
});

export function kycRouter() {
  const router = Router();

  router.post(
    '/submit',
    authenticateUser,
    upload.fields([
      { name: 'idFront', maxCount: 1 },
      { name: 'idBack', maxCount: 1 },
      { name: 'selfie', maxCount: 1 }
    ]),
    asyncHandler(async (req, res) => {
      const files = req.files as Record<string, Express.Multer.File[] | undefined>;
      const idFront = files?.idFront?.[0];
      const idBack = files?.idBack?.[0];
      const selfie = files?.selfie?.[0];
      if (!idFront) throw new ApiError(400, 'Missing idFront', { errorCode: 'KYC_MISSING_ID_FRONT' });

      const body = z
        .object({
          clientOcrText: z.string().max(50_000).optional(),
          clientDobRaw: z.string().max(100).optional(),
          clientConfidence: z.coerce.number().min(0).max(1).optional()
        })
        .parse(req.body ?? {});

      try {
        const result = await submitKycAttempt({
          userId: req.user!.id,
          files: { idFront, idBack, selfie },
          clientOcrText: body.clientOcrText,
          clientDobRaw: body.clientDobRaw,
          clientConfidence: body.clientConfidence
        });

        if (!result.ok) {
          if (result.error === 'USER_NOT_FOUND') throw new ApiError(404, 'User not found', { errorCode: 'NOT_FOUND' });
          if (result.error === 'ALREADY_VERIFIED') {
            throw new ApiError(409, 'KYC already verified', { errorCode: 'KYC_ALREADY_VERIFIED' });
          }
          throw new ApiError(400, 'KYC submit failed', { errorCode: 'KYC_SUBMIT_FAILED' });
        }

        res.status(201).json({
          success: true,
          data: {
            kycStatus: result.kycStatus,
            attemptId: result.attemptId,
            autoDecision: result.autoDecision
          }
        });

        (req as any).log?.info({ userId: req.user!.id, attemptId: result.attemptId, kycStatus: result.kycStatus, autoDecision: result.autoDecision }, 'KYC submitted');
      } catch (e: any) {
        if (e instanceof CloudinaryNotConfiguredError) {
          throw new ApiError(501, 'Cloudinary not configured', { errorCode: 'CLOUDINARY_NOT_CONFIGURED' });
        }
        throw e;
      }
    })
  );

  router.get(
    '/status',
    authenticateUser,
    asyncHandler(async (req, res) => {
      const user = await UserModel.findById(req.user!.id).exec();
      if (!user) throw new ApiError(404, 'User not found', { errorCode: 'NOT_FOUND' });

      const lastAttemptId = user.kycLastAttemptId?.toString?.() ?? undefined;
      const attempt = lastAttemptId
        ? await KycAttemptModel.findById(lastAttemptId).select({ submittedAt: 1, reviewedAt: 1 }).exec()
        : null;

      res.status(200).json({
        success: true,
        data: {
          kycStatus: user.kycStatus,
          lastAttemptId,
          submittedAt: attempt?.submittedAt?.toISOString?.() ?? undefined,
          reviewedAt: attempt?.reviewedAt?.toISOString?.() ?? undefined,
          rejectionReason: user.kycRejectionReason ?? undefined
        }
      });
    })
  );

  // Multer error mapping
  router.use((err: any, _req: any, _res: any, next: any) => {
    if (err?.code === 'LIMIT_FILE_SIZE') {
      return next(new ApiError(400, 'File too large', { errorCode: 'KYC_FILE_TOO_LARGE' }));
    }
    return next(err);
  });

  return router;
}
