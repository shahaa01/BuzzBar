import { Router } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { asyncHandler } from '../../common/utils/async_handler.js';
import { ApiError } from '../../common/middleware/error_handler.js';
import { authenticateUser } from '../auth/user.middleware.js';
import { addOrIncrementCartItem, clearCart, computeCartSummary, removeCartItem, setCartItemQty } from './cart.service.js';

function ensureObjectId(id: string) {
  if (!mongoose.isValidObjectId(id)) throw new ApiError(400, 'Invalid id', { errorCode: 'INVALID_ID' });
  return id;
}

export function cartRouter() {
  const router = Router();

  router.get(
    '/',
    authenticateUser,
    asyncHandler(async (req, res) => {
      const summary = await computeCartSummary(req.user!.id);
      if (!summary) throw new ApiError(404, 'Cart not found', { errorCode: 'NOT_FOUND' });
      res.status(200).json({ success: true, data: summary });
    })
  );

  router.post(
    '/items',
    authenticateUser,
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          variantId: z.string().min(1),
          qty: z.number().int().min(1)
        })
        .parse(req.body);

      const variantId = ensureObjectId(body.variantId);
      const result = await addOrIncrementCartItem({ userId: req.user!.id, variantId, qty: body.qty });
      if (!result.ok) {
        if (result.errorCode === 'VARIANT_NOT_FOUND') throw new ApiError(404, 'Variant not found', { errorCode: 'VARIANT_NOT_FOUND' });
        if (result.errorCode === 'VARIANT_INACTIVE') throw new ApiError(409, 'Variant inactive', { errorCode: 'VARIANT_INACTIVE' });
        if (result.errorCode === 'OUT_OF_STOCK') throw new ApiError(409, 'Out of stock', { errorCode: 'OUT_OF_STOCK', details: { available: result.available ?? 0 } });
        if (result.errorCode === 'INSUFFICIENT_STOCK') throw new ApiError(409, 'Insufficient stock', { errorCode: 'INSUFFICIENT_STOCK', details: { available: result.available ?? 0 } });
        if (result.errorCode === 'INVALID_QTY') throw new ApiError(400, 'Invalid qty', { errorCode: 'INVALID_QTY' });
        throw new ApiError(400, 'Cart update failed', { errorCode: 'CART_UPDATE_FAILED' });
      }

      const summary = await computeCartSummary(req.user!.id);
      res.status(200).json({ success: true, data: summary });
    })
  );

  router.patch(
    '/items/:variantId',
    authenticateUser,
    asyncHandler(async (req, res) => {
      const variantId = ensureObjectId(req.params.variantId);
      const body = z.object({ qty: z.number().int().min(0) }).parse(req.body);

      const result = await setCartItemQty({ userId: req.user!.id, variantId, qty: body.qty });
      if (!result.ok) {
        if (result.errorCode === 'VARIANT_NOT_FOUND') throw new ApiError(404, 'Variant not found', { errorCode: 'VARIANT_NOT_FOUND' });
        if (result.errorCode === 'VARIANT_INACTIVE') throw new ApiError(409, 'Variant inactive', { errorCode: 'VARIANT_INACTIVE' });
        if (result.errorCode === 'OUT_OF_STOCK') throw new ApiError(409, 'Out of stock', { errorCode: 'OUT_OF_STOCK', details: { available: result.available ?? 0 } });
        if (result.errorCode === 'INSUFFICIENT_STOCK') throw new ApiError(409, 'Insufficient stock', { errorCode: 'INSUFFICIENT_STOCK', details: { available: result.available ?? 0 } });
        if (result.errorCode === 'INVALID_QTY') throw new ApiError(400, 'Invalid qty', { errorCode: 'INVALID_QTY' });
        throw new ApiError(400, 'Cart update failed', { errorCode: 'CART_UPDATE_FAILED' });
      }

      const summary = await computeCartSummary(req.user!.id);
      res.status(200).json({ success: true, data: summary });
    })
  );

  router.delete(
    '/items/:variantId',
    authenticateUser,
    asyncHandler(async (req, res) => {
      const variantId = ensureObjectId(req.params.variantId);
      await removeCartItem({ userId: req.user!.id, variantId });
      const summary = await computeCartSummary(req.user!.id);
      res.status(200).json({ success: true, data: summary });
    })
  );

  router.post(
    '/clear',
    authenticateUser,
    asyncHandler(async (req, res) => {
      await clearCart(req.user!.id);
      const summary = await computeCartSummary(req.user!.id);
      res.status(200).json({ success: true, data: summary });
    })
  );

  return router;
}

