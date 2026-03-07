import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../common/utils/async_handler.js';
import { ApiError } from '../../common/middleware/error_handler.js';
import { authenticateAdmin, requireAdminRole } from '../admin/admin.middleware.js';
import { adminAssignOrder, adminListOrders, adminUpdateOrderStatus, cancelOrderAndReleaseStock } from './orders.service.js';
import type { OrderStatus } from './orders.models.js';

const ORDER_ROLES = ['superadmin', 'admin', 'employee'] as const;

export function ordersAdminRouter() {
  const router = Router();

  router.get(
    '/orders',
    authenticateAdmin,
    requireAdminRole([...ORDER_ROLES]),
    asyncHandler(async (req, res) => {
      const query = z
        .object({
          status: z.string().optional(),
          paymentStatus: z.string().optional(),
          page: z.coerce.number().int().positive().default(1),
          limit: z.coerce.number().int().positive().max(100).default(20)
        })
        .parse(req.query ?? {});

      const out = await adminListOrders({ status: query.status, paymentStatus: query.paymentStatus, page: query.page, limit: query.limit });
      res.status(200).json({ success: true, data: { items: out.items, page: query.page, limit: query.limit, total: out.total } });
    })
  );

  router.patch(
    '/orders/:id/status',
    authenticateAdmin,
    requireAdminRole([...ORDER_ROLES]),
    asyncHandler(async (req, res) => {
      const params = z.object({ id: z.string().min(1) }).parse(req.params);
      const body = z.object({ status: z.string().min(1) }).parse(req.body ?? {});

      const nextStatus = body.status as OrderStatus;
      const result = await adminUpdateOrderStatus({ orderId: params.id, nextStatus, adminId: req.admin!.id });
      if (!result.ok) {
        if (result.errorCode === 'INVALID_STATUS_TRANSITION') {
          throw new ApiError(409, 'Invalid status transition', { errorCode: 'INVALID_STATUS_TRANSITION', details: result.details });
        }
        if (result.errorCode === 'KYC_REVIEW_REQUIRED') throw new ApiError(409, 'KYC review required', { errorCode: 'KYC_REVIEW_REQUIRED' });
        if (result.errorCode === 'PAYMENT_NOT_PAID') throw new ApiError(409, 'Payment not paid', { errorCode: 'PAYMENT_NOT_PAID' });
        throw new ApiError(400, 'Status update failed', { errorCode: 'ORDER_STATUS_UPDATE_FAILED' });
      }

      res.status(200).json({ success: true, data: { status: result.status } });
    })
  );

  router.patch(
    '/orders/:id/assign',
    authenticateAdmin,
    requireAdminRole([...ORDER_ROLES]),
    asyncHandler(async (req, res) => {
      const params = z.object({ id: z.string().min(1) }).parse(req.params);
      const body = z.object({ assignedToAdminId: z.string().min(1) }).parse(req.body ?? {});

      const result = await adminAssignOrder({ orderId: params.id, assignedToAdminId: body.assignedToAdminId });
      if (!result.ok) {
        if (result.errorCode === 'INVALID_ID') throw new ApiError(400, 'Invalid id', { errorCode: 'INVALID_ID' });
        if (result.errorCode === 'NOT_FOUND') throw new ApiError(404, 'Order not found', { errorCode: 'NOT_FOUND' });
        throw new ApiError(400, 'Assign failed', { errorCode: 'ORDER_ASSIGN_FAILED' });
      }
      res.status(200).json({ success: true, data: { ok: true } });
    })
  );

  router.post(
    '/orders/:id/cancel',
    authenticateAdmin,
    requireAdminRole([...ORDER_ROLES]),
    asyncHandler(async (req, res) => {
      const params = z.object({ id: z.string().min(1) }).parse(req.params);
      const body = z.object({ reason: z.string().min(1).max(500).optional() }).parse(req.body ?? {});

      const result = await cancelOrderAndReleaseStock({ orderId: params.id, actorAdminId: req.admin!.id, reason: body.reason ?? 'admin_cancelled' });
      if (!result.ok) {
        if (result.errorCode === 'NOT_FOUND') throw new ApiError(404, 'Order not found', { errorCode: 'NOT_FOUND' });
        if (result.errorCode === 'ORDER_TERMINAL') throw new ApiError(409, 'Order is terminal', { errorCode: 'ORDER_TERMINAL' });
        throw new ApiError(400, 'Cancel failed', { errorCode: 'ORDER_CANCEL_FAILED' });
      }
      res.status(200).json({ success: true, data: { ok: true } });
    })
  );

  return router;
}

