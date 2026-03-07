import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../common/utils/async_handler.js';
import { ApiError } from '../../common/middleware/error_handler.js';
import { authenticateUser } from '../auth/user.middleware.js';
import { createOrderFromCart, getCustomerOrderDetail, listCustomerOrders } from './orders.service.js';

export function ordersRouter() {
  const router = Router();

  router.post(
    '/',
    authenticateUser,
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          paymentMethod: z.enum(['COD', 'WALLET']),
          promoCode: z.string().min(1).optional(),
          address: z.object({
            label: z.string().optional(),
            fullAddress: z.string().min(3),
            area: z.string().min(1),
            landmark: z.string().optional(),
            lat: z.number().optional(),
            lng: z.number().optional(),
            contactName: z.string().optional(),
            contactPhone: z.string().optional()
          })
        })
        .parse(req.body);

      const result = await createOrderFromCart({
        userId: req.user!.id,
        paymentMethod: body.paymentMethod,
        promoCode: body.promoCode,
        address: body.address
      });

      if (!result.ok) {
        if (result.errorCode === 'CART_EMPTY') throw new ApiError(409, 'Cart is empty', { errorCode: 'CART_EMPTY' });
        if (result.errorCode === 'KYC_REJECTED') throw new ApiError(403, 'KYC rejected', { errorCode: 'KYC_REJECTED' });
        if (result.errorCode === 'SERVICE_AREA_NOT_SUPPORTED') throw new ApiError(409, 'Service area not supported', { errorCode: 'SERVICE_AREA_NOT_SUPPORTED' });
        if (result.errorCode === 'NIGHT_HOURS_COD_REJECTED') throw new ApiError(409, 'COD not allowed in night hours', { errorCode: 'NIGHT_HOURS_COD_REJECTED' });
        if (result.errorCode === 'OUT_OF_STOCK') throw new ApiError(409, 'Out of stock', { errorCode: 'OUT_OF_STOCK', details: (result as any).details });
        if (result.errorCode === 'INSUFFICIENT_STOCK') throw new ApiError(409, 'Insufficient stock', { errorCode: 'INSUFFICIENT_STOCK', details: (result as any).details });
        if (result.errorCode === 'VARIANT_INACTIVE') throw new ApiError(409, 'Variant inactive', { errorCode: 'VARIANT_INACTIVE' });
        if (result.errorCode === 'PROMO_INVALID') throw new ApiError(409, 'Promo invalid', { errorCode: 'PROMO_INVALID', details: (result as any).details });
        throw new ApiError(400, 'Order creation failed', { errorCode: 'ORDER_CREATE_FAILED', details: (result as any).details });
      }

      res.status(201).json({ success: true, data: { orderId: result.orderId, orderNumber: result.orderNumber } });
    })
  );

  router.get(
    '/',
    authenticateUser,
    asyncHandler(async (req, res) => {
      const query = z
        .object({
          page: z.coerce.number().int().positive().default(1),
          limit: z.coerce.number().int().positive().max(100).default(20)
        })
        .parse(req.query ?? {});

      const out = await listCustomerOrders({ userId: req.user!.id, page: query.page, limit: query.limit });
      res.status(200).json({ success: true, data: { items: out.items, page: query.page, limit: query.limit, total: out.total } });
    })
  );

  router.get(
    '/:id',
    authenticateUser,
    asyncHandler(async (req, res) => {
      const params = z.object({ id: z.string().min(1) }).parse(req.params);
      const order = await getCustomerOrderDetail({ userId: req.user!.id, orderId: params.id });
      if (!order) throw new ApiError(404, 'Order not found', { errorCode: 'NOT_FOUND' });
      res.status(200).json({ success: true, data: order });
    })
  );

  return router;
}

