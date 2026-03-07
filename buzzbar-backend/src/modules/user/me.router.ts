import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../common/utils/async_handler.js';
import { ApiError } from '../../common/middleware/error_handler.js';
import { authenticateUser } from '../auth/user.middleware.js';
import { UserModel } from './user.models.js';
import { toUserPublic } from './user.public.js';

export function meRouter() {
  const router = Router();

  router.get(
    '/',
    authenticateUser,
    asyncHandler(async (req, res) => {
      const user = await UserModel.findById(req.user!.id);
      if (!user) throw new ApiError(404, 'User not found', { errorCode: 'NOT_FOUND' });
      res.status(200).json({ success: true, data: toUserPublic(user) });
    })
  );

  router.put(
    '/',
    authenticateUser,
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          name: z.string().min(1).optional(),
          phone: z.string().min(6).optional(),
          photoUrl: z.string().url().optional()
        })
        .parse(req.body);

      const user = await UserModel.findById(req.user!.id);
      if (!user) throw new ApiError(404, 'User not found', { errorCode: 'NOT_FOUND' });

      if (body.name !== undefined) user.name = body.name;
      if (body.phone !== undefined) user.phone = body.phone;
      if (body.photoUrl !== undefined) user.photoUrl = body.photoUrl;

      await user.save();
      res.status(200).json({ success: true, data: toUserPublic(user) });
    })
  );

  return router;
}

