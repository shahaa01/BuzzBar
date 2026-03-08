import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { asyncHandler } from '../../common/utils/async_handler.js';
import { ApiError } from '../../common/middleware/error_handler.js';
import { authenticateAdmin, requireAdminRole } from '../admin/admin.middleware.js';
import { AdminUserModel } from '../admin/admin.models.js';
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
          reason: z.string().min(1).max(500)
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
      const quantityAfter = Number(stock.quantity ?? 0);
      const quantityBefore = quantityAfter - delta;
      const movement = await InventoryMovementModel.create({
        variantId,
        type,
        delta: body.delta,
        reason: body.reason,
        quantityBefore,
        quantityAfter,
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
    '/inventory/movements',
    authenticateAdmin,
    requireAdminRole(['superadmin', 'admin']),
    asyncHandler(async (req, res) => {
      const query = z
        .object({
          q: z.string().optional(),
          actorAdminId: z.string().optional(),
          actor: z.string().optional(),
          type: z.enum(['RECEIVE', 'ADJUST', 'SALE', 'RETURN']).optional(),
          from: z.string().optional(),
          to: z.string().optional(),
          page: z.coerce.number().int().positive().default(1),
          limit: z.coerce.number().int().positive().max(100).default(20)
        })
        .parse(req.query ?? {});

      const limitAllowed = new Set([20, 50, 100]);
      if (!limitAllowed.has(query.limit)) {
        throw new ApiError(400, 'Invalid limit', { errorCode: 'INVALID_LIMIT', details: { allowed: [...limitAllowed] } });
      }

      const filter: any = {};
      if (query.type) filter.type = query.type;

      if (query.actorAdminId) {
        if (!mongoose.isValidObjectId(query.actorAdminId)) throw new ApiError(400, 'Invalid actor id', { errorCode: 'INVALID_ID' });
        filter.actorAdminId = ensureObjectId(query.actorAdminId);
      } else if (query.actor) {
        const actor = query.actor.trim();
        if (actor) {
          const escaped = actor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const re = new RegExp(escaped, 'i');
          const admins = (await AdminUserModel.find({ email: re }).select({ _id: 1 }).limit(50).lean().exec()) as any[];
          const ids = admins.map((a) => a._id as mongoose.Types.ObjectId);
          if (ids.length === 0) {
            res.status(200).json({ success: true, data: { items: [], page: query.page, limit: query.limit, total: 0 } });
            return;
          }
          filter.actorAdminId = { $in: ids };
        }
      }

      const fromDate = query.from ? new Date(query.from) : null;
      const toDate = query.to ? new Date(query.to) : null;
      if (query.from && Number.isNaN(fromDate!.getTime())) throw new ApiError(400, 'Invalid from', { errorCode: 'INVALID_DATE' });
      if (query.to && Number.isNaN(toDate!.getTime())) throw new ApiError(400, 'Invalid to', { errorCode: 'INVALID_DATE' });
      if (fromDate || toDate) {
        filter.createdAt = {};
        if (fromDate) filter.createdAt.$gte = fromDate;
        if (toDate) filter.createdAt.$lt = toDate;
      }

      const q = (query.q ?? '').trim();
      if (q) {
        const skuRe = new RegExp(`^${q.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}$`, 'i');
        const nameRe = new RegExp(q.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&'), 'i');

        const [skuVariants, nameProducts] = await Promise.all([
          VariantModel.find({ sku: skuRe }).select({ _id: 1 }).lean().exec(),
          ProductModel.find({ name: nameRe }).select({ _id: 1 }).lean().exec()
        ]);

        let variantIds: mongoose.Types.ObjectId[] = skuVariants.map((v: any) => v._id as mongoose.Types.ObjectId);
        if (nameProducts.length > 0) {
          const productIds = nameProducts.map((p: any) => p._id as mongoose.Types.ObjectId);
          const productVariants = await VariantModel.find({ productId: { $in: productIds } }).select({ _id: 1 }).lean().exec();
          variantIds = variantIds.concat(productVariants.map((v: any) => v._id as mongoose.Types.ObjectId));
        }

        const unique = [...new Map(variantIds.map((id) => [id.toString(), id])).values()];
        if (unique.length === 0) {
          res.status(200).json({ success: true, data: { items: [], page: query.page, limit: query.limit, total: 0 } });
          return;
        }
        filter.variantId = { $in: unique };
      }

      const skip = (query.page - 1) * query.limit;
      const [movements, total] = await Promise.all([
        InventoryMovementModel.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(query.limit)
          .populate({
            path: 'actorAdminId',
            select: { email: 1, role: 1 }
          })
          .populate({
            path: 'variantId',
            select: { sku: 1, volumeMl: 1, packSize: 1, productId: 1 },
            populate: { path: 'productId', select: { name: 1, slug: 1 } }
          })
          .lean()
          .exec(),
        InventoryMovementModel.countDocuments(filter)
      ]);

      const items = movements.map((m: any) => ({
        id: m._id.toString(),
        createdAt: m.createdAt?.toISOString?.() ?? new Date(m.createdAt).toISOString(),
        type: m.type,
        delta: m.delta,
        reason: m.reason,
        quantityBefore: m.quantityBefore,
        quantityAfter: m.quantityAfter,
        actor: m.actorAdminId
          ? { id: m.actorAdminId._id.toString(), email: m.actorAdminId.email, role: m.actorAdminId.role }
          : { id: String(m.actorAdminId), email: undefined, role: undefined },
        variant: m.variantId
          ? {
              id: m.variantId._id.toString(),
              sku: m.variantId.sku,
              volumeMl: m.variantId.volumeMl,
              packSize: m.variantId.packSize
            }
          : { id: String(m.variantId) },
        product: m.variantId?.productId
          ? {
              id: m.variantId.productId._id.toString(),
              name: m.variantId.productId.name,
              slug: m.variantId.productId.slug
            }
          : { id: String(m.variantId?.productId ?? '') }
      }));

      res.status(200).json({ success: true, data: { items, page: query.page, limit: query.limit, total } });
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

      const products = (await ProductModel.find({ _id: { $in: variants.map((v) => v.productId) } })
        .select({ name: 1, slug: 1, isActive: 1 })
        .lean()
        .exec()) as any[];
      const productById = new Map(products.map((p) => [p._id.toString(), p]));

      const stocks = (await InventoryStockModel.find({ variantId: { $in: variants.map((v) => v._id) } })
        .lean()
        .exec()) as any[];
      const stockByVariant = new Map(stocks.map((s) => [s.variantId.toString(), s]));

      const items = variants
        .map((v) => {
          const stock = stockByVariant.get(v._id.toString()) ?? { quantity: 0, reserved: 0 };
          const availability = computeAvailability(stock as any);
          const product = productById.get(v.productId.toString());
          return {
            variant: v,
            product: product ? { id: product._id.toString(), name: product.name, slug: product.slug, isActive: product.isActive } : undefined,
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
