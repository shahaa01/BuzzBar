import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../common/utils/async_handler.js';
import { ApiError } from '../../common/middleware/error_handler.js';
import { authenticateAdmin, requireAdminRole } from '../admin/admin.middleware.js';
import { adminGetPaymentTransaction, adminListPaymentTransactions } from './payments.service.js';

const PAYMENT_ROLES = ['superadmin', 'admin', 'employee'] as const;

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
          page: z.coerce.number().int().positive().default(1),
          limit: z.coerce.number().int().positive().max(100).default(20)
        })
        .parse(req.query ?? {});

      const out = await adminListPaymentTransactions({
        provider: query.provider?.trim().toUpperCase() as any,
        status: query.status?.trim().toUpperCase() as any,
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
      const tx = await adminGetPaymentTransaction({ id: params.id });
      if (!tx) throw new ApiError(404, 'Payment transaction not found', { errorCode: 'NOT_FOUND' });
      res.status(200).json({ success: true, data: tx });
    })
  );

  return router;
}

