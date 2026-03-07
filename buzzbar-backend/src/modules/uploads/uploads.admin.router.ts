import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { ApiError } from '../../common/middleware/error_handler.js';
import { asyncHandler } from '../../common/utils/async_handler.js';
import { authenticateAdmin, requireAdminRole } from '../admin/admin.middleware.js';
import { CloudinaryNotConfiguredError, destroyCloudinaryImage, uploadImageToCloudinary } from './cloudinary.service.js';

const MAX_FILE_SIZE_BYTES = 7 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter(_req, file, cb) {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new ApiError(400, 'Unsupported file type', { errorCode: 'UPLOAD_UNSUPPORTED_MIME' }));
    }
    return cb(null, true);
  }
});

export function uploadsAdminRouter() {
  const router = Router();

  router.post(
    '/uploads/image',
    authenticateAdmin,
    requireAdminRole(['superadmin', 'admin']),
    upload.single('file'),
    asyncHandler(async (req, res) => {
      const file = req.file;
      if (!file) throw new ApiError(400, 'Missing file', { errorCode: 'UPLOAD_MISSING_FILE' });

      const body = z
        .object({
          target: z.enum(['categories', 'brands', 'products']).optional(),
          targetId: z.string().min(1).optional()
        })
        .parse(req.body ?? {});

      const folder =
        body.target && body.targetId
          ? `buzzbar/${body.target}/${body.targetId}`
          : 'buzzbar/misc';

      let asset;
      try {
        asset = await uploadImageToCloudinary({ buffer: file.buffer, folder });
      } catch (e: any) {
        if (e instanceof CloudinaryNotConfiguredError) {
          throw new ApiError(501, 'Cloudinary not configured', { errorCode: 'CLOUDINARY_NOT_CONFIGURED' });
        }
        throw new ApiError(500, 'Cloudinary upload failed', {
          errorCode: 'CLOUDINARY_UPLOAD_FAILED',
          details: { message: e?.message }
        });
      }

      res.status(200).json({ success: true, data: asset });
    })
  );

  router.post(
    '/uploads/destroy',
    authenticateAdmin,
    requireAdminRole(['superadmin', 'admin']),
    asyncHandler(async (req, res) => {
      const body = z.object({ publicId: z.string().min(1) }).parse(req.body);
      try {
        const result = await destroyCloudinaryImage(body.publicId);
        res.status(200).json({ success: true, data: result });
      } catch (e: any) {
        if (e instanceof CloudinaryNotConfiguredError) {
          throw new ApiError(501, 'Cloudinary not configured', { errorCode: 'CLOUDINARY_NOT_CONFIGURED' });
        }
        throw new ApiError(500, 'Cloudinary destroy failed', {
          errorCode: 'CLOUDINARY_DESTROY_FAILED',
          details: { message: e?.message }
        });
      }
    })
  );

  // Multer error mapping
  router.use((err: any, _req: any, _res: any, next: any) => {
    if (err?.code === 'LIMIT_FILE_SIZE') {
      return next(new ApiError(400, 'File too large', { errorCode: 'UPLOAD_FILE_TOO_LARGE' }));
    }
    return next(err);
  });

  return router;
}
