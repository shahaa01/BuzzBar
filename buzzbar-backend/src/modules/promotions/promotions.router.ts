import { Router } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { asyncHandler } from '../../common/utils/async_handler.js';
import { ApiError } from '../../common/middleware/error_handler.js';
import { authenticateUser } from '../auth/user.middleware.js';
import { validatePromotion } from './promotions.service.js';

export function promotionsRouter() {
  const router = Router();

  router.post(
    '/validate',
    authenticateUser,
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          code: z.string().min(1),
          items: z
            .array(
              z.object({
                variantId: z.string().min(1),
                qty: z.number().int().min(1)
              })
            )
            .optional()
        })
        .parse(req.body ?? {});

      if (body.items) {
        for (const it of body.items) {
          if (!mongoose.isValidObjectId(it.variantId)) throw new ApiError(400, 'Invalid variantId', { errorCode: 'INVALID_ID' });
        }
      }

      const out = await validatePromotion(
        body.items
          ? { code: body.code, userId: req.user!.id, mode: 'items', items: body.items }
          : { code: body.code, userId: req.user!.id, mode: 'cart' }
      );

      res.status(200).json({ success: true, data: out });
    })
  );

  return router;
}

