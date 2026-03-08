import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../common/utils/async_handler.js';
import { ApiError } from '../../common/middleware/error_handler.js';
import { authenticateAdmin, requireAdminRole } from '../admin/admin.middleware.js';
import { adminGetPaymentTransactionDetailed, adminListPaymentTransactionsDetailed } from './payments.service.js';

const PAYMENT_ROLES = ['superadmin', 'admin'] as const;

export function paymentsAdminRouter() {
  const router = Router();

  router.get(
    '/payments',
    authenticateAdmin,
    requireAdminRole([...PAYMENT_ROLES]),
    asyncHandler(async (req, res) => {
      const query = z
        .object({
          provider: z.string().optional(),
          status: z.string().optional(),
          paymentMethod: z.enum(['COD', 'WALLET']).optional(),
          from: z.string().optional(),
          to: z.string().optional(),
          q: z.string().optional(),
          stalePending: z.coerce.boolean().optional(),
          sort: z.enum(['createdAt_desc', 'createdAt_asc', 'amount_desc', 'amount_asc', 'updatedAt_desc']).default('createdAt_desc'),
          page: z.coerce.number().int().positive().default(1),
          limit: z.coerce.number().int().positive().max(100).default(20)
        })
        .parse(req.query ?? {});

      const limitAllowed = new Set([20, 50, 100]);
      if (!limitAllowed.has(query.limit)) {
        throw new ApiError(400, 'Invalid limit', { errorCode: 'INVALID_LIMIT', details: { allowed: [...limitAllowed] } });
      }
      if (query.from && Number.isNaN(new Date(query.from).getTime())) {
        throw new ApiError(400, 'Invalid from date', { errorCode: 'INVALID_DATE' });
      }
      if (query.to && Number.isNaN(new Date(query.to).getTime())) {
        throw new ApiError(400, 'Invalid to date', { errorCode: 'INVALID_DATE' });
      }

      const out = await adminListPaymentTransactionsDetailed({
        provider: query.provider?.trim().toUpperCase() as any,
        status: query.status?.trim().toUpperCase() as any,
        paymentMethod: query.paymentMethod,
        from: query.from,
        to: query.to,
        q: query.q,
        stalePending: query.stalePending,
        sort: query.sort,
        page: query.page,
        limit: query.limit
      });

      res.status(200).json({ success: true, data: { items: out.items, page: query.page, limit: query.limit, total: out.total } });
    })
  );

  router.get(
    '/payments/:id',
    authenticateAdmin,
    requireAdminRole([...PAYMENT_ROLES]),
    asyncHandler(async (req, res) => {
      const params = z.object({ id: z.string().min(1) }).parse(req.params);
      const tx = await adminGetPaymentTransactionDetailed({ id: params.id });
      if (!tx) throw new ApiError(404, 'Payment transaction not found', { errorCode: 'NOT_FOUND' });
      res.status(200).json({ success: true, data: tx });
    })
  );

  return router;
}
