import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../common/utils/async_handler.js';
import { ApiError } from '../../common/middleware/error_handler.js';
import { authenticateAdmin, requireAdminRole } from '../admin/admin.middleware.js';
import { adminAssignOrder, adminListOrders, adminMarkAgeVerificationFailed, adminTransitionOrder, adminUnassignOrder, adminUpdateOrderStatus, cancelOrderAndReleaseStock, getAdminOrderDetail, listOrderAssignees } from './orders.service.js';
import type { OrderStatus } from './orders.models.js';

const ORDER_ROLES = ['superadmin', 'admin', 'employee'] as const;
const ORDER_ASSIGNMENT_ROLES = ['superadmin', 'admin'] as const;

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
          paymentMethod: z.string().optional(),
          paymentStatus: z.string().optional(),
          kycStatusSnapshot: z.string().optional(),
          assigned: z.enum(['assigned', 'unassigned']).optional(),
          serviceArea: z.string().optional(),
          from: z.string().optional(),
          to: z.string().optional(),
          q: z.string().optional(),
          sort: z.enum(['createdAt_desc', 'createdAt_asc', 'total_desc', 'total_asc']).default('createdAt_desc'),
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

      const out = await adminListOrders({
        status: query.status,
        paymentMethod: query.paymentMethod,
        paymentStatus: query.paymentStatus,
        kycStatusSnapshot: query.kycStatusSnapshot,
        assigned: query.assigned,
        serviceArea: query.serviceArea,
        from: query.from,
        to: query.to,
        q: query.q,
        sort: query.sort,
        page: query.page,
        limit: query.limit
      });
      res.status(200).json({ success: true, data: { items: out.items, page: query.page, limit: query.limit, total: out.total } });
    })
  );

  router.get(
    '/orders/assignees',
    authenticateAdmin,
    requireAdminRole([...ORDER_ASSIGNMENT_ROLES]),
    asyncHandler(async (_req, res) => {
      const items = await listOrderAssignees();
      res.status(200).json({ success: true, data: { items } });
    })
  );

  router.get(
    '/orders/:id',
    authenticateAdmin,
    requireAdminRole([...ORDER_ROLES]),
    asyncHandler(async (req, res) => {
      const params = z.object({ id: z.string().min(1) }).parse(req.params);
      const detail = await getAdminOrderDetail({ orderId: params.id });
      if (!detail) throw new ApiError(404, 'Order not found', { errorCode: 'NOT_FOUND' });
      res.status(200).json({ success: true, data: detail });
    })
  );

  router.post(
    '/orders/:id/transition',
    authenticateAdmin,
    requireAdminRole([...ORDER_ROLES]),
    asyncHandler(async (req, res) => {
      const params = z.object({ id: z.string().min(1) }).parse(req.params);
      const body = z.object({ actionId: z.string().min(1) }).parse(req.body ?? {});

      const result = await adminTransitionOrder({ orderId: params.id, actionId: body.actionId, adminId: req.admin!.id });
      if (!result.ok) {
        if (result.errorCode === 'ORDER_TRANSITION_INVALID') {
          throw new ApiError(409, 'Invalid status transition', { errorCode: 'ORDER_TRANSITION_INVALID', details: result.details });
        }
        if (result.errorCode === 'KYC_REQUIRED') throw new ApiError(409, 'KYC required', { errorCode: 'KYC_REQUIRED' });
        if (result.errorCode === 'KYC_REVIEW_REQUIRED') throw new ApiError(409, 'KYC review required', { errorCode: 'KYC_REVIEW_REQUIRED' });
        if (result.errorCode === 'PAYMENT_NOT_PAID') throw new ApiError(409, 'Payment not paid', { errorCode: 'PAYMENT_NOT_PAID' });
        if (result.errorCode === 'ORDER_ALREADY_DELIVERED') {
          throw new ApiError(409, 'Order already delivered', { errorCode: 'ORDER_ALREADY_DELIVERED', details: result.details });
        }
        throw new ApiError(400, 'Status update failed', { errorCode: 'ORDER_STATUS_UPDATE_FAILED' });
      }

      res.status(200).json({ success: true, data: { status: result.status, actionId: result.actionId } });
    })
  );

  router.patch(
    '/orders/:id/status',
    authenticateAdmin,
    requireAdminRole([...ORDER_ROLES]),
    asyncHandler(async (req, res) => {
      res.setHeader('Deprecation', 'true');
      res.setHeader('Warning', '299 - "Deprecated: use POST /api/v1/admin/orders/:id/transition"');
      const params = z.object({ id: z.string().min(1) }).parse(req.params);
      const body = z.object({ status: z.string().min(1) }).parse(req.body ?? {});

      const nextStatus = body.status as OrderStatus;
      const result = await adminUpdateOrderStatus({ orderId: params.id, nextStatus, adminId: req.admin!.id });
      if (!result.ok) {
        if (result.errorCode === 'ORDER_TRANSITION_INVALID') {
          throw new ApiError(409, 'Invalid status transition', { errorCode: 'INVALID_STATUS_TRANSITION', details: result.details });
        }
        if (result.errorCode === 'KYC_REQUIRED') throw new ApiError(409, 'KYC required', { errorCode: 'KYC_REQUIRED' });
        if (result.errorCode === 'KYC_REVIEW_REQUIRED') throw new ApiError(409, 'KYC review required', { errorCode: 'KYC_REVIEW_REQUIRED' });
        if (result.errorCode === 'PAYMENT_NOT_PAID') throw new ApiError(409, 'Payment not paid', { errorCode: 'PAYMENT_NOT_PAID' });
        if (result.errorCode === 'ORDER_ALREADY_DELIVERED') {
          throw new ApiError(409, 'Order already delivered', { errorCode: 'ORDER_ALREADY_DELIVERED', details: result.details });
        }
        throw new ApiError(400, 'Status update failed', { errorCode: 'ORDER_STATUS_UPDATE_FAILED' });
      }

      res.status(200).json({ success: true, data: { status: result.status } });
    })
  );

  router.patch(
    '/orders/:id/assign',
    authenticateAdmin,
    requireAdminRole([...ORDER_ASSIGNMENT_ROLES]),
    asyncHandler(async (req, res) => {
      const params = z.object({ id: z.string().min(1) }).parse(req.params);
      const body = z.object({ assignedToAdminId: z.string().min(1) }).parse(req.body ?? {});

      const result = await adminAssignOrder({ orderId: params.id, assignedToAdminId: body.assignedToAdminId, actorAdminId: req.admin!.id });
      if (!result.ok) {
        if (result.errorCode === 'INVALID_ID') throw new ApiError(400, 'Invalid id', { errorCode: 'INVALID_ID' });
        if (result.errorCode === 'NOT_FOUND') throw new ApiError(404, 'Order not found', { errorCode: 'NOT_FOUND' });
        throw new ApiError(400, 'Assign failed', { errorCode: 'ORDER_ASSIGN_FAILED' });
      }
      res.status(200).json({ success: true, data: { ok: true } });
    })
  );

  router.post(
    '/orders/:id/unassign',
    authenticateAdmin,
    requireAdminRole([...ORDER_ASSIGNMENT_ROLES]),
    asyncHandler(async (req, res) => {
      const params = z.object({ id: z.string().min(1) }).parse(req.params);
      const result = await adminUnassignOrder({ orderId: params.id, actorAdminId: req.admin!.id });
      if (!result.ok) {
        if (result.errorCode === 'INVALID_ID') throw new ApiError(400, 'Invalid id', { errorCode: 'INVALID_ID' });
        if (result.errorCode === 'NOT_FOUND') throw new ApiError(404, 'Order not found', { errorCode: 'NOT_FOUND' });
        throw new ApiError(400, 'Unassign failed', { errorCode: 'ORDER_UNASSIGN_FAILED' });
      }
      res.status(200).json({ success: true, data: { ok: true } });
    })
  );

  router.post(
    '/orders/:id/age-verification-failed',
    authenticateAdmin,
    requireAdminRole([...ORDER_ROLES]),
    asyncHandler(async (req, res) => {
      const params = z.object({ id: z.string().min(1) }).parse(req.params);
      const body = z.object({ note: z.string().min(1).max(500).optional() }).parse(req.body ?? {});

      const result = await adminMarkAgeVerificationFailed({ orderId: params.id, adminId: req.admin!.id, note: body.note });
      if (!result.ok) {
        if (result.errorCode === 'NOT_FOUND') throw new ApiError(404, 'Order not found', { errorCode: 'NOT_FOUND' });
        if (result.errorCode === 'AGE_VERIFICATION_ACTION_NOT_ALLOWED') {
          throw new ApiError(409, 'Age verification action not allowed', { errorCode: 'AGE_VERIFICATION_ACTION_NOT_ALLOWED', details: (result as any).details });
        }
        if (result.errorCode === 'ORDER_TERMINAL') throw new ApiError(409, 'Order is terminal', { errorCode: 'ORDER_TERMINAL' });
        throw new ApiError(400, 'Age verification failure handling failed', { errorCode: 'AGE_VERIFICATION_FAILED' });
      }

      res.status(200).json({ success: true, data: { ok: true, status: result.status, userStatusChanged: result.userStatusChanged } });
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
