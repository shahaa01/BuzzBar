import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../common/utils/async_handler.js';
import { ApiError } from '../../common/middleware/error_handler.js';
import { authenticateUser } from '../auth/user.middleware.js';
import { confirmPayment, initPayment } from './payments.service.js';

export function paymentsRouter() {
  const router = Router();

  router.post(
    '/init',
    authenticateUser,
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          orderId: z.string().min(1),
          provider: z.string().min(1)
        })
        .parse(req.body ?? {});

      const out = await initPayment({ userId: req.user!.id, orderId: body.orderId, provider: body.provider });
      if (!out.ok) {
        if (out.errorCode === 'PAYMENT_PROVIDER_NOT_SUPPORTED') throw new ApiError(400, 'Provider not supported', { errorCode: out.errorCode, details: (out as any).details });
        if (out.errorCode === 'PAYMENT_INVALID_ORDER') throw new ApiError(404, 'Order not found', { errorCode: out.errorCode });
        if (out.errorCode === 'PAYMENT_INVALID_METHOD') throw new ApiError(409, 'Payment not applicable', { errorCode: out.errorCode });
        if (out.errorCode === 'PAYMENT_ALREADY_TERMINAL') throw new ApiError(409, 'Payment is terminal', { errorCode: out.errorCode });
        throw new ApiError(400, 'Payment init failed', { errorCode: 'PAYMENT_INIT_FAILED' });
      }

      (req as any).log?.info({ orderId: body.orderId, provider: body.provider, status: out.status }, 'Payment initiated');
      res.status(200).json({ success: true, data: out });
    })
  );

  router.post(
    '/confirm',
    authenticateUser,
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          orderId: z.string().min(1),
          provider: z.string().min(1),
          payload: z.unknown().optional()
        })
        .parse(req.body ?? {});

      const out = await confirmPayment({ userId: req.user!.id, orderId: body.orderId, provider: body.provider, payload: body.payload });
      if (!out.ok) {
        if (out.errorCode === 'PAYMENT_PROVIDER_NOT_SUPPORTED') throw new ApiError(400, 'Provider not supported', { errorCode: out.errorCode, details: (out as any).details });
        if (out.errorCode === 'PAYMENT_INVALID_ORDER') throw new ApiError(404, 'Order not found', { errorCode: out.errorCode });
        if (out.errorCode === 'PAYMENT_TRANSACTION_NOT_FOUND') throw new ApiError(404, 'Payment transaction not found', { errorCode: out.errorCode });
        if (out.errorCode === 'PAYMENT_INVALID_METHOD') throw new ApiError(409, 'Payment not applicable', { errorCode: out.errorCode });
        if (out.errorCode === 'PAYMENT_ALREADY_TERMINAL') throw new ApiError(409, 'Order is terminal', { errorCode: out.errorCode });
        if (out.errorCode === 'PAYMENT_CONFIRMATION_FAILED') throw new ApiError(409, 'Payment confirmation failed', { errorCode: out.errorCode });
        throw new ApiError(400, 'Payment confirm failed', { errorCode: 'PAYMENT_CONFIRM_FAILED' });
      }

      const level = out.status === 'FAILED' ? 'warn' : 'info';
      (req as any).log?.[level]({ orderId: body.orderId, provider: body.provider, status: out.status }, 'Payment confirmed');
      res.status(200).json({ success: true, data: out });
    })
  );

  return router;
}
