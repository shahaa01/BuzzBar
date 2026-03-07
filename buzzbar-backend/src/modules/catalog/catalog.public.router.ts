import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { asyncHandler } from '../../common/utils/async_handler.js';
import { ApiError } from '../../common/middleware/error_handler.js';
import { BrandModel, CategoryModel, ProductModel, VariantModel } from './catalog.models.js';
import { InventoryStockModel, computeAvailability } from '../inventory/inventory.models.js';

function parseObjectIdOrSlug(input: string) {
  const trimmed = input.trim();
  if (mongoose.isValidObjectId(trimmed)) return { kind: 'id' as const, value: trimmed };
  return { kind: 'slug' as const, value: trimmed.toLowerCase() };
}

async function resolveCategoryId(input: string) {
  const parsed = parseObjectIdOrSlug(input);
  if (parsed.kind === 'id') return parsed.value;
  const doc = (await CategoryModel.findOne({ slug: parsed.value, isActive: true })
    .select({ _id: 1 })
    .lean()
    .exec()) as any;
  return doc?._id?.toString?.() ?? null;
}

async function resolveBrandId(input: string) {
  const parsed = parseObjectIdOrSlug(input);
  if (parsed.kind === 'id') return parsed.value;
  const doc = (await BrandModel.findOne({ slug: parsed.value, isActive: true })
    .select({ _id: 1 })
    .lean()
    .exec()) as any;
  return doc?._id?.toString?.() ?? null;
}

export function catalogPublicRouter() {
  const router = Router();

  router.get(
    '/categories',
    asyncHandler(async (_req, res) => {
      const items = await CategoryModel.find({ isActive: true })
        .sort({ sortOrder: 1, name: 1 })
        .lean();
      res.status(200).json({ success: true, data: items });
    })
  );

  router.get(
    '/brands',
    asyncHandler(async (_req, res) => {
      const items = await BrandModel.find({ isActive: true }).sort({ name: 1 }).lean();
      res.status(200).json({ success: true, data: items });
    })
  );

  router.get(
    '/products',
    asyncHandler(async (req, res) => {
      const query = z
        .object({
          q: z.string().optional(),
          category: z.string().optional(),
          brand: z.string().optional(),
          minPrice: z.coerce.number().int().min(0).optional(),
          maxPrice: z.coerce.number().int().min(0).optional(),
          minAbv: z.coerce.number().min(0).optional(),
          maxAbv: z.coerce.number().min(0).optional(),
          volumeMl: z.coerce.number().int().min(1).optional(),
          inStock: z.enum(['true', 'false']).optional(),
          sort: z.enum(['price_asc', 'price_desc', 'newest']).optional(),
          page: z.coerce.number().int().min(1).default(1),
          limit: z.coerce.number().int().min(1).max(50).default(20)
        })
        .parse(req.query);

      const categoryId = query.category ? await resolveCategoryId(query.category) : null;
      const brandId = query.brand ? await resolveBrandId(query.brand) : null;

      if (query.category && !categoryId) {
        res.status(200).json({ success: true, data: { items: [], page: query.page, limit: query.limit, total: 0 } });
        return;
      }
      if (query.brand && !brandId) {
        res.status(200).json({ success: true, data: { items: [], page: query.page, limit: query.limit, total: 0 } });
        return;
      }

      const match: any = { isActive: true };
      if (categoryId) match.categoryId = new mongoose.Types.ObjectId(categoryId);
      if (brandId) match.brandId = new mongoose.Types.ObjectId(brandId);
      if (query.q && query.q.trim().length > 0) {
        // Prefer text search if possible; fallback to name regex
        match.$or = [
          { name: { $regex: query.q.trim(), $options: 'i' } },
          { description: { $regex: query.q.trim(), $options: 'i' } }
        ];
      }
      if (query.minAbv !== undefined || query.maxAbv !== undefined) {
        match.abv = {};
        if (query.minAbv !== undefined) match.abv.$gte = query.minAbv;
        if (query.maxAbv !== undefined) match.abv.$lte = query.maxAbv;
      }

      const variantMatch: any = { $expr: { $eq: ['$productId', '$$pid'] }, isActive: true };
      if (query.volumeMl !== undefined) variantMatch.volumeMl = query.volumeMl;
      if (query.minPrice !== undefined || query.maxPrice !== undefined) {
        variantMatch.price = {};
        if (query.minPrice !== undefined) variantMatch.price.$gte = query.minPrice;
        if (query.maxPrice !== undefined) variantMatch.price.$lte = query.maxPrice;
      }

      const pipeline: any[] = [
        { $match: match },
        {
          $lookup: {
            from: VariantModel.collection.name,
            let: { pid: '$_id' },
            pipeline: [
              { $match: variantMatch },
              {
                $lookup: {
                  from: InventoryStockModel.collection.name,
                  localField: '_id',
                  foreignField: 'variantId',
                  as: 'stock'
                }
              },
              { $addFields: { stock: { $ifNull: [{ $first: '$stock' }, { quantity: 0, reserved: 0 }] } } },
              {
                $addFields: {
                  availability: {
                    $max: [{ $subtract: ['$stock.quantity', '$stock.reserved'] }, 0]
                  }
                }
              }
            ],
            as: 'variants'
          }
        },
        // Only return sellable products (at least one matching active variant)
        { $match: { 'variants.0': { $exists: true } } },
        {
          $addFields: {
            minPrice: { $min: '$variants.price' },
            hasStock: {
              $gt: [
                {
                  $size: {
                    $filter: {
                      input: '$variants',
                      as: 'v',
                      cond: { $gt: ['$$v.availability', 0] }
                    }
                  }
                },
                0
              ]
            }
          }
        }
      ];

      if (query.inStock === 'true') pipeline.push({ $match: { hasStock: true } });
      if (query.inStock === 'false') pipeline.push({ $match: { hasStock: false } });

      // Sorting
      if (query.sort === 'newest') pipeline.push({ $sort: { createdAt: -1 } });
      else if (query.sort === 'price_desc') pipeline.push({ $sort: { minPrice: -1, createdAt: -1 } });
      else pipeline.push({ $sort: { minPrice: 1, createdAt: -1 } }); // default price_asc

      const skip = (query.page - 1) * query.limit;
      const dataPipeline = [...pipeline, { $skip: skip }, { $limit: query.limit }];
      const countPipeline = [...pipeline, { $count: 'total' }];

      const [items, countRes] = await Promise.all([
        ProductModel.aggregate(dataPipeline),
        ProductModel.aggregate(countPipeline)
      ]);

      const total = countRes?.[0]?.total ?? 0;

      res.status(200).json({
        success: true,
        data: {
          items,
          page: query.page,
          limit: query.limit,
          total
        }
      });
    })
  );

  router.get(
    '/products/:id',
    asyncHandler(async (req, res) => {
      const raw = req.params.id.trim();
      const product =
        (mongoose.isValidObjectId(raw)
          ? await ProductModel.findById(raw).lean().exec()
          : await ProductModel.findOne({ slug: raw.toLowerCase() }).lean().exec()) as any;
      if (!product || !product.isActive) throw new ApiError(404, 'Product not found', { errorCode: 'NOT_FOUND' });

      const variants = (await VariantModel.find({ productId: product._id, isActive: true }).lean().exec()) as any[];
      const stocks = (await InventoryStockModel.find({ variantId: { $in: variants.map((v) => v._id) } })
        .lean()
        .exec()) as any[];
      const stockByVariant = new Map(stocks.map((s) => [s.variantId.toString(), s]));

      const variantsWithAvailability = variants.map((v) => {
        const stock = stockByVariant.get(v._id.toString());
        return {
          ...v,
          availability: computeAvailability(stock as any)
        };
      });

      res.status(200).json({
        success: true,
        data: {
          product,
          variants: variantsWithAvailability
        }
      });
    })
  );

  return router;
}
