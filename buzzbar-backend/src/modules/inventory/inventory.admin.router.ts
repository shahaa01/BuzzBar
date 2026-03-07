import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { asyncHandler } from '../../common/utils/async_handler.js';
import { ApiError } from '../../common/middleware/error_handler.js';
import { authenticateAdmin, requireAdminRole } from '../admin/admin.middleware.js';
import { ProductModel, VariantModel } from '../catalog/catalog.models.js';
import { InventoryMovementModel, InventoryStockModel, computeAvailability } from './inventory.models.js';

function ensureObjectId(id: string) {
  if (!mongoose.isValidObjectId(id)) throw new ApiError(400, 'Invalid id', { errorCode: 'INVALID_ID' });
  return new mongoose.Types.ObjectId(id);
}

export function inventoryAdminRouter() {
  const router = Router();

  router.patch(
    '/inventory/adjust',
    authenticateAdmin,
    requireAdminRole(['superadmin', 'admin', 'employee']),
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          variantId: z.string().min(1),
          delta: z.number().int(),
          reason: z.string().min(1).optional()
        })
        .parse(req.body);

      if (body.delta === 0) throw new ApiError(400, 'Delta cannot be zero', { errorCode: 'INVALID_DELTA' });

      const variantId = ensureObjectId(body.variantId);
      const variant = await VariantModel.findById(variantId).select({ _id: 1, productId: 1 }).lean();
      if (!variant) throw new ApiError(404, 'Variant not found', { errorCode: 'NOT_FOUND' });

      const now = new Date();
      const delta = body.delta;

      // Atomic invariants:
      // - quantity never < 0
      // - reserved never < 0 (reserved isn't adjusted in P1.3, but we guard anyway)
      // - quantity never goes below reserved (so availability = quantity - reserved stays >= 0)
      const stock = (await InventoryStockModel.findOneAndUpdate(
        {
          variantId,
          ...(delta < 0
            ? {
                quantity: { $gte: -delta },
                $expr: { $gte: [{ $add: ['$quantity', delta] }, '$reserved'] }
              }
            : {})
        },
        {
          $inc: { quantity: delta },
          $setOnInsert: { reserved: 0 },
          $set: { updatedAt: now }
        },
        {
          upsert: delta > 0,
          new: true,
          setDefaultsOnInsert: true
        }
      )
        .lean()
        .exec()) as any;

      if (!stock) {
        throw new ApiError(409, 'Insufficient stock', { errorCode: 'INSUFFICIENT_STOCK' });
      }
      if ((stock.quantity ?? 0) < 0 || (stock.reserved ?? 0) < 0) {
        throw new ApiError(500, 'Inventory invariant violated', { errorCode: 'INVENTORY_INVARIANT_VIOLATION' });
      }
      if ((stock.reserved ?? 0) > (stock.quantity ?? 0)) {
        throw new ApiError(500, 'Inventory invariant violated', { errorCode: 'INVENTORY_INVARIANT_VIOLATION' });
      }

      const type = body.delta > 0 ? 'RECEIVE' : 'ADJUST';
      const movement = await InventoryMovementModel.create({
        variantId,
        type,
        delta: body.delta,
        reason: body.reason,
        actorAdminId: req.admin!.id
      });

      res.status(200).json({
        success: true,
        data: {
          stock,
          availability: computeAvailability(stock as any),
          movement
        }
      });
    })
  );

  router.get(
    '/inventory',
    authenticateAdmin,
    requireAdminRole(['superadmin', 'admin', 'employee']),
    asyncHandler(async (req, res) => {
      const query = z
        .object({
          productId: z.string().optional(),
          brandId: z.string().optional(),
          categoryId: z.string().optional(),
          lowStock: z.coerce.number().int().min(0).optional(),
          page: z.coerce.number().int().min(1).default(1),
          limit: z.coerce.number().int().min(1).max(100).default(50)
        })
        .parse(req.query);

      const productMatch: any = {};
      if (query.productId) productMatch._id = ensureObjectId(query.productId);
      if (query.brandId) productMatch.brandId = ensureObjectId(query.brandId);
      if (query.categoryId) productMatch.categoryId = ensureObjectId(query.categoryId);

      let productIds: mongoose.Types.ObjectId[] | null = null;
      if (Object.keys(productMatch).length > 0) {
        const products = (await ProductModel.find(productMatch).select({ _id: 1 }).lean().exec()) as any[];
        productIds = products.map((p) => p._id as mongoose.Types.ObjectId);
        if (productIds.length === 0) {
          res.status(200).json({ success: true, data: { items: [], page: query.page, limit: query.limit, total: 0 } });
          return;
        }
      }

      const variantMatch: any = {};
      if (productIds && productIds.length > 0) variantMatch.productId = { $in: productIds };

      const skip = (query.page - 1) * query.limit;

      const variants = (await VariantModel.find(variantMatch)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(query.limit)
        .lean()
        .exec()) as any[];

      const total = await VariantModel.countDocuments(variantMatch);

      const stocks = (await InventoryStockModel.find({ variantId: { $in: variants.map((v) => v._id) } })
        .lean()
        .exec()) as any[];
      const stockByVariant = new Map(stocks.map((s) => [s.variantId.toString(), s]));

      const items = variants
        .map((v) => {
          const stock = stockByVariant.get(v._id.toString()) ?? { quantity: 0, reserved: 0 };
          const availability = computeAvailability(stock as any);
          return {
            variant: v,
            stock,
            availability
          };
        })
        .filter((row) => {
          if (query.lowStock === undefined) return true;
          return (row.stock.quantity ?? 0) <= query.lowStock;
        });

      res.status(200).json({
        success: true,
        data: { items, page: query.page, limit: query.limit, total }
      });
    })
  );

  return router;
}
