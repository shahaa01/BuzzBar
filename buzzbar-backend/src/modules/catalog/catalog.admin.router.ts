import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { asyncHandler } from '../../common/utils/async_handler.js';
import { ApiError } from '../../common/middleware/error_handler.js';
import { authenticateAdmin, requireAdminRole } from '../admin/admin.middleware.js';
import { BrandModel, CategoryModel, ProductModel, VariantModel } from './catalog.models.js';
import { makeSlug } from './slug.js';
import { InventoryStockModel } from '../inventory/inventory.models.js';

const cloudinaryAssetSchema = z.object({
  url: z.string().url(),
  publicId: z.string().min(1),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  format: z.string().min(1).optional()
});

const ADMIN_LIST_LIMIT_ALLOWED = new Set([20, 50, 100]);

function ensureObjectId(id: string) {
  if (!mongoose.isValidObjectId(id)) throw new ApiError(400, 'Invalid id', { errorCode: 'INVALID_ID' });
  return new mongoose.Types.ObjectId(id);
}

function isDuplicateSlugError(err: any) {
  return err?.code === 11000 && (err?.keyPattern?.slug || err?.keyValue?.slug);
}

function isDuplicateSkuError(err: any) {
  return err?.code === 11000 && (err?.keyPattern?.sku || err?.keyValue?.sku);
}

function escapeRegex(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeOptionalText(value?: string | null) {
  if (value === undefined || value === null) return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeStringList(values?: string[] | null, opts?: { lowercase?: boolean }) {
  if (!values) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const normalized = opts?.lowercase ? trimmed.toLowerCase() : trimmed;
    const key = opts?.lowercase ? normalized : normalized.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

async function createWithUniqueSlug<TDoc>(opts: {
  baseSlug: string;
  existsFn: (slug: string) => Promise<boolean>;
  createFn: (slug: string) => Promise<TDoc>;
}) {
  let slug = opts.baseSlug;
  for (let attempt = 0; attempt < 25; attempt++) {
    if (await opts.existsFn(slug)) {
      slug = `${opts.baseSlug}-${attempt + 2}`;
      continue;
    }

    try {
      return await opts.createFn(slug);
    } catch (e: any) {
      if (isDuplicateSlugError(e)) {
        slug = `${opts.baseSlug}-${attempt + 2}`;
        continue;
      }
      throw e;
    }
  }
  throw new ApiError(409, 'Slug already exists', { errorCode: 'SLUG_ALREADY_EXISTS' });
}

async function ensureInventoryStockExists(variantId: mongoose.Types.ObjectId) {
  await InventoryStockModel.updateOne(
    { variantId },
    { $setOnInsert: { variantId, quantity: 0, reserved: 0 } },
    { upsert: true }
  );
}

export function catalogAdminRouter() {
  const router = Router();

  // Categories reads (admin+)
  router.get(
    '/categories',
    authenticateAdmin,
    requireAdminRole(['superadmin', 'admin']),
    asyncHandler(async (req, res) => {
      const query = z
        .object({
          q: z.string().optional(),
          isActive: z.enum(['active', 'inactive', 'all']).default('all'),
          page: z.coerce.number().int().min(1).default(1),
          limit: z.coerce.number().int().min(1).max(100).default(20)
        })
        .parse(req.query ?? {});

      if (!ADMIN_LIST_LIMIT_ALLOWED.has(query.limit)) {
        throw new ApiError(400, 'Invalid limit', {
          errorCode: 'INVALID_LIMIT',
          details: { allowed: [...ADMIN_LIST_LIMIT_ALLOWED] }
        });
      }

      const filter: any = {};
      if (query.isActive === 'active') filter.isActive = true;
      if (query.isActive === 'inactive') filter.isActive = false;

      const q = (query.q ?? '').trim();
      if (q) {
        const re = new RegExp(escapeRegex(q), 'i');
        filter.$or = [{ name: re }, { slug: re }];
      }

      const skip = (query.page - 1) * query.limit;
      const [items, total] = await Promise.all([
        CategoryModel.find(filter).sort({ sortOrder: 1, name: 1 }).skip(skip).limit(query.limit).lean().exec(),
        CategoryModel.countDocuments(filter)
      ]);

      res.status(200).json({
        success: true,
        data: {
          items: items.map((c: any) => ({
            id: c._id.toString(),
            name: c.name,
            slug: c.slug,
            image: c.image,
            sortOrder: c.sortOrder,
            isActive: c.isActive,
            createdAt: c.createdAt?.toISOString?.() ?? new Date(c.createdAt).toISOString(),
            updatedAt: c.updatedAt?.toISOString?.() ?? new Date(c.updatedAt).toISOString()
          })),
          page: query.page,
          limit: query.limit,
          total
        }
      });
    })
  );

  router.get(
    '/categories/:id',
    authenticateAdmin,
    requireAdminRole(['superadmin', 'admin']),
    asyncHandler(async (req, res) => {
      const id = ensureObjectId(req.params.id);
      const category = await CategoryModel.findById(id).lean().exec();
      if (!category) throw new ApiError(404, 'Category not found', { errorCode: 'NOT_FOUND' });
      res.status(200).json({
        success: true,
        data: {
          id: (category as any)._id.toString(),
          name: (category as any).name,
          slug: (category as any).slug,
          image: (category as any).image,
          sortOrder: (category as any).sortOrder,
          isActive: (category as any).isActive,
          createdAt: (category as any).createdAt?.toISOString?.() ?? new Date((category as any).createdAt).toISOString(),
          updatedAt: (category as any).updatedAt?.toISOString?.() ?? new Date((category as any).updatedAt).toISOString()
        }
      });
    })
  );

  // Brands reads (admin+)
  router.get(
    '/brands',
    authenticateAdmin,
    requireAdminRole(['superadmin', 'admin']),
    asyncHandler(async (req, res) => {
      const query = z
        .object({
          q: z.string().optional(),
          isActive: z.enum(['active', 'inactive', 'all']).default('all'),
          page: z.coerce.number().int().min(1).default(1),
          limit: z.coerce.number().int().min(1).max(100).default(20)
        })
        .parse(req.query ?? {});

      if (!ADMIN_LIST_LIMIT_ALLOWED.has(query.limit)) {
        throw new ApiError(400, 'Invalid limit', {
          errorCode: 'INVALID_LIMIT',
          details: { allowed: [...ADMIN_LIST_LIMIT_ALLOWED] }
        });
      }

      const filter: any = {};
      if (query.isActive === 'active') filter.isActive = true;
      if (query.isActive === 'inactive') filter.isActive = false;

      const q = (query.q ?? '').trim();
      if (q) {
        const re = new RegExp(escapeRegex(q), 'i');
        filter.$or = [{ name: re }, { slug: re }];
      }

      const skip = (query.page - 1) * query.limit;
      const [items, total] = await Promise.all([
        BrandModel.find(filter).sort({ name: 1 }).skip(skip).limit(query.limit).lean().exec(),
        BrandModel.countDocuments(filter)
      ]);

      res.status(200).json({
        success: true,
        data: {
          items: items.map((b: any) => ({
            id: b._id.toString(),
            name: b.name,
            slug: b.slug,
            logo: b.logo,
            isActive: b.isActive,
            createdAt: b.createdAt?.toISOString?.() ?? new Date(b.createdAt).toISOString(),
            updatedAt: b.updatedAt?.toISOString?.() ?? new Date(b.updatedAt).toISOString()
          })),
          page: query.page,
          limit: query.limit,
          total
        }
      });
    })
  );

  router.get(
    '/brands/:id',
    authenticateAdmin,
    requireAdminRole(['superadmin', 'admin']),
    asyncHandler(async (req, res) => {
      const id = ensureObjectId(req.params.id);
      const brand = await BrandModel.findById(id).lean().exec();
      if (!brand) throw new ApiError(404, 'Brand not found', { errorCode: 'NOT_FOUND' });
      res.status(200).json({
        success: true,
        data: {
          id: (brand as any)._id.toString(),
          name: (brand as any).name,
          slug: (brand as any).slug,
          logo: (brand as any).logo,
          isActive: (brand as any).isActive,
          createdAt: (brand as any).createdAt?.toISOString?.() ?? new Date((brand as any).createdAt).toISOString(),
          updatedAt: (brand as any).updatedAt?.toISOString?.() ?? new Date((brand as any).updatedAt).toISOString()
        }
      });
    })
  );

  // Products reads (admin+)
  router.get(
    '/products',
    authenticateAdmin,
    requireAdminRole(['superadmin', 'admin', 'employee']),
    asyncHandler(async (req, res) => {
      const query = z
        .object({
          q: z.string().optional(),
          brandId: z.string().optional(),
          categoryId: z.string().optional(),
          isActive: z.enum(['active', 'inactive', 'all']).default('all'),
          lowStockThreshold: z.coerce.number().int().min(0).default(5),
          sort: z.string().optional(),
          page: z.coerce.number().int().min(1).default(1),
          limit: z.coerce.number().int().min(1).max(100).default(20)
        })
        .parse(req.query ?? {});

      if (!ADMIN_LIST_LIMIT_ALLOWED.has(query.limit)) {
        throw new ApiError(400, 'Invalid limit', {
          errorCode: 'INVALID_LIMIT',
          details: { allowed: [...ADMIN_LIST_LIMIT_ALLOWED] }
        });
      }

      const match: any = {};
      if (query.isActive === 'active') match.isActive = true;
      if (query.isActive === 'inactive') match.isActive = false;
      if (query.brandId) match.brandId = ensureObjectId(query.brandId);
      if (query.categoryId) match.categoryId = ensureObjectId(query.categoryId);

      const q = (query.q ?? '').trim();
      if (q) {
        const re = new RegExp(escapeRegex(q), 'i');
        match.$or = [{ name: re }, { slug: re }];
      }

      const sortRaw = (query.sort ?? '').trim();
      const sortKey =
        sortRaw === 'newest'
          ? 'createdAt_desc'
          : sortRaw === 'name'
            ? 'name_asc'
            : sortRaw === 'createdAt'
              ? 'createdAt_desc'
              : sortRaw === 'updatedAt'
                ? 'updatedAt_desc'
                : sortRaw === 'stockStatus'
                  ? 'stockStatus_asc'
                  : sortRaw || 'updatedAt_desc';

      const SORT_ALLOWED = new Set([
        'name_asc',
        'name_desc',
        'createdAt_asc',
        'createdAt_desc',
        'updatedAt_asc',
        'updatedAt_desc',
        'stockStatus_asc',
        'stockStatus_desc'
      ]);

      if (!SORT_ALLOWED.has(sortKey)) {
        throw new ApiError(400, 'Invalid sort', { errorCode: 'INVALID_SORT' });
      }

      const sort: any =
        sortKey === 'name_asc'
          ? { name: 1, updatedAt: -1, _id: -1 }
          : sortKey === 'name_desc'
            ? { name: -1, updatedAt: -1, _id: -1 }
            : sortKey === 'createdAt_asc'
              ? { createdAt: 1, _id: 1 }
              : sortKey === 'createdAt_desc'
                ? { createdAt: -1, _id: -1 }
                : sortKey === 'updatedAt_asc'
                  ? { updatedAt: 1, _id: 1 }
                  : sortKey === 'updatedAt_desc'
                    ? { updatedAt: -1, _id: -1 }
                    : sortKey === 'stockStatus_desc'
                      ? { stockStatusRank: -1, updatedAt: -1, _id: -1 }
                      : { stockStatusRank: 1, updatedAt: -1, _id: -1 };

      const pipeline: any[] = [
        { $match: match },
        {
          $lookup: {
            from: BrandModel.collection.name,
            localField: 'brandId',
            foreignField: '_id',
            as: 'brand'
          }
        },
        { $addFields: { brand: { $ifNull: [{ $first: '$brand' }, null] } } },
        {
          $lookup: {
            from: CategoryModel.collection.name,
            localField: 'categoryId',
            foreignField: '_id',
            as: 'category'
          }
        },
        { $addFields: { category: { $ifNull: [{ $first: '$category' }, null] } } },
        {
          $lookup: {
            from: VariantModel.collection.name,
            let: { pid: '$_id' },
            pipeline: [
              { $match: { $expr: { $eq: ['$productId', '$$pid'] } } },
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
              },
              { $project: { isActive: 1, availability: 1 } }
            ],
            as: 'variants'
          }
        },
        {
          $addFields: {
            primaryImage: { $ifNull: [{ $arrayElemAt: [{ $ifNull: ['$images', []] }, 0] }, null] },
            imagesCount: { $size: { $ifNull: ['$images', []] } },
            variantsCount: { $size: { $ifNull: ['$variants', []] } },
            activeVariantAvailabilities: {
              $map: {
                input: {
                  $filter: {
                    input: { $ifNull: ['$variants', []] },
                    as: 'v',
                    cond: { $eq: ['$$v.isActive', true] }
                  }
                },
                as: 'v',
                in: '$$v.availability'
              }
            }
          }
        },
        {
          $addFields: {
            minAvail: {
              $cond: [
                { $gt: [{ $size: '$activeVariantAvailabilities' }, 0] },
                { $min: '$activeVariantAvailabilities' },
                null
              ]
            }
          }
        },
        {
          $addFields: {
            stockStatus: {
              $switch: {
                branches: [
                  {
                    case: { $or: [{ $eq: ['$minAvail', null] }, { $eq: ['$minAvail', 0] }] },
                    then: 'out_of_stock'
                  },
                  { case: { $lte: ['$minAvail', query.lowStockThreshold] }, then: 'low_stock' }
                ],
                default: 'in_stock'
              }
            }
          }
        },
        {
          $addFields: {
            stockStatusRank: {
              $switch: {
                branches: [
                  { case: { $eq: ['$stockStatus', 'out_of_stock'] }, then: 0 },
                  { case: { $eq: ['$stockStatus', 'low_stock'] }, then: 1 }
                ],
                default: 2
              }
            }
          }
        },
        { $sort: sort }
      ];

      const skip = (query.page - 1) * query.limit;
      const dataPipeline = [...pipeline, { $skip: skip }, { $limit: query.limit }];
      const countPipeline = [...pipeline, { $count: 'total' }];

      const [items, countRes] = await Promise.all([ProductModel.aggregate(dataPipeline), ProductModel.aggregate(countPipeline)]);
      const total = countRes?.[0]?.total ?? 0;

      res.status(200).json({
        success: true,
        data: {
          items: items.map((p: any) => ({
            id: p._id.toString(),
            name: p.name,
            slug: p.slug,
            isActive: p.isActive,
            brand: p.brand ? { id: p.brand._id.toString(), name: p.brand.name, slug: p.brand.slug } : null,
            category: p.category ? { id: p.category._id.toString(), name: p.category.name, slug: p.category.slug } : null,
            primaryImage: p.primaryImage ?? null,
            imagesCount: p.imagesCount ?? 0,
            variantsCount: p.variantsCount ?? 0,
            stockStatus: p.stockStatus,
            createdAt: p.createdAt?.toISOString?.() ?? new Date(p.createdAt).toISOString(),
            updatedAt: p.updatedAt?.toISOString?.() ?? new Date(p.updatedAt).toISOString()
          })),
          page: query.page,
          limit: query.limit,
          total
        }
      });
    })
  );

  router.get(
    '/products/:id',
    authenticateAdmin,
    requireAdminRole(['superadmin', 'admin', 'employee']),
    asyncHandler(async (req, res) => {
      const productId = ensureObjectId(req.params.id);
      const product = (await ProductModel.findById(productId).lean().exec()) as any;
      if (!product) throw new ApiError(404, 'Product not found', { errorCode: 'NOT_FOUND' });

      const [brand, category, variants] = await Promise.all([
        BrandModel.findById(product.brandId).select({ name: 1, slug: 1, isActive: 1 }).lean().exec(),
        CategoryModel.findById(product.categoryId).select({ name: 1, slug: 1, isActive: 1 }).lean().exec(),
        VariantModel.find({ productId: product._id }).lean().exec()
      ]);

      const stocks = (await InventoryStockModel.find({ variantId: { $in: variants.map((v: any) => v._id) } })
        .select({ variantId: 1, quantity: 1, reserved: 1 })
        .lean()
        .exec()) as any[];
      const stockByVariant = new Map(stocks.map((s) => [s.variantId.toString(), s]));

      const variantsWithStock = variants.map((v: any) => {
        const stock = stockByVariant.get(v._id.toString()) ?? { quantity: 0, reserved: 0 };
        const quantity = Number(stock.quantity ?? 0);
        const reserved = Number(stock.reserved ?? 0);
        const available = Math.max(quantity - reserved, 0);
        return {
          id: v._id.toString(),
          sku: v.sku,
          label: v.label,
          volumeMl: v.volumeMl,
          packSize: v.packSize,
          price: v.price,
          mrp: v.mrp,
          isActive: v.isActive,
          createdAt: v.createdAt?.toISOString?.() ?? new Date(v.createdAt).toISOString(),
          updatedAt: v.updatedAt?.toISOString?.() ?? new Date(v.updatedAt).toISOString(),
          stock: { quantity, reserved, available }
        };
      });

      res.status(200).json({
        success: true,
        data: {
          product: {
            id: product._id.toString(),
            name: product.name,
            slug: product.slug,
            brandId: product.brandId?.toString?.() ?? String(product.brandId),
            categoryId: product.categoryId?.toString?.() ?? String(product.categoryId),
            countryOfOrigin: product.countryOfOrigin,
            productType: product.productType,
            subcategory: product.subcategory,
            ingredients: product.ingredients ?? [],
            servingSuggestion: product.servingSuggestion,
            agingInfo: product.agingInfo,
            authenticityNote: product.authenticityNote,
            shortDescription: product.shortDescription,
            tags: product.tags ?? [],
            description: product.description,
            abv: product.abv,
            images: product.images ?? [],
            isActive: product.isActive,
            createdAt: product.createdAt?.toISOString?.() ?? new Date(product.createdAt).toISOString(),
            updatedAt: product.updatedAt?.toISOString?.() ?? new Date(product.updatedAt).toISOString()
          },
          variants: variantsWithStock,
          brand: brand ? { id: (brand as any)._id.toString(), name: (brand as any).name, slug: (brand as any).slug, isActive: (brand as any).isActive } : null,
          category: category
            ? { id: (category as any)._id.toString(), name: (category as any).name, slug: (category as any).slug, isActive: (category as any).isActive }
            : null
        }
      });
    })
  );

  // Categories (admin+)
  router.post(
    '/categories',
    authenticateAdmin,
    requireAdminRole(['superadmin', 'admin']),
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          name: z.string().min(1),
          slug: z.string().min(1).optional(),
          image: cloudinaryAssetSchema.optional(),
          sortOrder: z.number().int().optional(),
          isActive: z.boolean().optional()
        })
        .parse(req.body);

      const baseSlug = (body.slug ? makeSlug(body.slug) : makeSlug(body.name)).toLowerCase();
      if (!baseSlug) throw new ApiError(400, 'Invalid slug', { errorCode: 'INVALID_SLUG' });
      const created = await createWithUniqueSlug({
        baseSlug,
        existsFn: async (slug) => (await CategoryModel.exists({ slug })) !== null,
        createFn: (slug) =>
          CategoryModel.create({
            name: body.name,
            slug,
            image: body.image,
            sortOrder: body.sortOrder ?? 0,
            isActive: body.isActive ?? true
          })
      });

      res.status(201).json({ success: true, data: created });
    })
  );

  router.put(
    '/categories/:id',
    authenticateAdmin,
    requireAdminRole(['superadmin', 'admin']),
    asyncHandler(async (req, res) => {
      const id = ensureObjectId(req.params.id);
      const body = z
        .object({
          name: z.string().min(1).optional(),
          slug: z.string().min(1).optional(),
          image: cloudinaryAssetSchema.nullable().optional(),
          sortOrder: z.number().int().optional(),
          isActive: z.boolean().optional()
        })
        .parse(req.body);

      const $set: any = {};
      const $unset: any = {};
      if (body.name !== undefined) $set.name = body.name;
      if (body.slug !== undefined) {
        const slug = makeSlug(body.slug).toLowerCase();
        if (!slug) throw new ApiError(400, 'Invalid slug', { errorCode: 'INVALID_SLUG' });
        const exists = (await CategoryModel.exists({ slug, _id: { $ne: id } })) !== null;
        if (exists) throw new ApiError(409, 'Slug already exists', { errorCode: 'SLUG_ALREADY_EXISTS' });
        $set.slug = slug;
      }
      if (body.image !== undefined) {
        if (body.image === null) $unset.image = 1;
        else $set.image = body.image;
      }
      if (body.sortOrder !== undefined) $set.sortOrder = body.sortOrder;
      if (body.isActive !== undefined) $set.isActive = body.isActive;

      let updated: any;
      try {
        updated = await CategoryModel.findByIdAndUpdate(
          id,
          {
            ...(Object.keys($set).length > 0 ? { $set } : { $set: {} }),
            ...(Object.keys($unset).length > 0 ? { $unset } : {})
          },
          { new: true, lean: true }
        );
      } catch (e: any) {
        if (isDuplicateSlugError(e)) {
          throw new ApiError(409, 'Slug already exists', { errorCode: 'SLUG_ALREADY_EXISTS' });
        }
        throw e;
      }
      if (!updated) throw new ApiError(404, 'Category not found', { errorCode: 'NOT_FOUND' });
      res.status(200).json({ success: true, data: updated });
    })
  );

  router.delete(
    '/categories/:id',
    authenticateAdmin,
    requireAdminRole(['superadmin', 'admin']),
    asyncHandler(async (req, res) => {
      const id = ensureObjectId(req.params.id);
      const category = await CategoryModel.findById(id).select({ _id: 1 }).lean().exec();
      if (!category) throw new ApiError(404, 'Category not found', { errorCode: 'NOT_FOUND' });
      const inUse = (await ProductModel.exists({ categoryId: id })) !== null;
      if (inUse) throw new ApiError(409, 'Category in use', { errorCode: 'CATEGORY_IN_USE' });
      await CategoryModel.findByIdAndUpdate(id, { $set: { isActive: false } }, { new: true, lean: true });
      res.status(200).json({ success: true, data: { ok: true } });
    })
  );

  // Brands (admin+)
  router.post(
    '/brands',
    authenticateAdmin,
    requireAdminRole(['superadmin', 'admin']),
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          name: z.string().min(1),
          slug: z.string().min(1).optional(),
          logo: cloudinaryAssetSchema.optional(),
          isActive: z.boolean().optional()
        })
        .parse(req.body);

      const baseSlug = (body.slug ? makeSlug(body.slug) : makeSlug(body.name)).toLowerCase();
      if (!baseSlug) throw new ApiError(400, 'Invalid slug', { errorCode: 'INVALID_SLUG' });
      const created = await createWithUniqueSlug({
        baseSlug,
        existsFn: async (slug) => (await BrandModel.exists({ slug })) !== null,
        createFn: (slug) =>
          BrandModel.create({
            name: body.name,
            slug,
            logo: body.logo,
            isActive: body.isActive ?? true
          })
      });
      res.status(201).json({ success: true, data: created });
    })
  );

  router.put(
    '/brands/:id',
    authenticateAdmin,
    requireAdminRole(['superadmin', 'admin']),
    asyncHandler(async (req, res) => {
      const id = ensureObjectId(req.params.id);
      const body = z
        .object({
          name: z.string().min(1).optional(),
          slug: z.string().min(1).optional(),
          logo: cloudinaryAssetSchema.nullable().optional(),
          isActive: z.boolean().optional()
        })
        .parse(req.body);

      const $set: any = {};
      const $unset: any = {};
      if (body.name !== undefined) $set.name = body.name;
      if (body.slug !== undefined) {
        const slug = makeSlug(body.slug).toLowerCase();
        if (!slug) throw new ApiError(400, 'Invalid slug', { errorCode: 'INVALID_SLUG' });
        const exists = (await BrandModel.exists({ slug, _id: { $ne: id } })) !== null;
        if (exists) throw new ApiError(409, 'Slug already exists', { errorCode: 'SLUG_ALREADY_EXISTS' });
        $set.slug = slug;
      }
      if (body.logo !== undefined) {
        if (body.logo === null) $unset.logo = 1;
        else $set.logo = body.logo;
      }
      if (body.isActive !== undefined) $set.isActive = body.isActive;

      let updated: any;
      try {
        updated = await BrandModel.findByIdAndUpdate(
          id,
          {
            ...(Object.keys($set).length > 0 ? { $set } : { $set: {} }),
            ...(Object.keys($unset).length > 0 ? { $unset } : {})
          },
          { new: true, lean: true }
        );
      } catch (e: any) {
        if (isDuplicateSlugError(e)) {
          throw new ApiError(409, 'Slug already exists', { errorCode: 'SLUG_ALREADY_EXISTS' });
        }
        throw e;
      }
      if (!updated) throw new ApiError(404, 'Brand not found', { errorCode: 'NOT_FOUND' });
      res.status(200).json({ success: true, data: updated });
    })
  );

  router.delete(
    '/brands/:id',
    authenticateAdmin,
    requireAdminRole(['superadmin', 'admin']),
    asyncHandler(async (req, res) => {
      const id = ensureObjectId(req.params.id);
      const brand = await BrandModel.findById(id).select({ _id: 1 }).lean().exec();
      if (!brand) throw new ApiError(404, 'Brand not found', { errorCode: 'NOT_FOUND' });
      const inUse = (await ProductModel.exists({ brandId: id })) !== null;
      if (inUse) throw new ApiError(409, 'Brand in use', { errorCode: 'BRAND_IN_USE' });
      await BrandModel.findByIdAndUpdate(id, { $set: { isActive: false } }, { new: true, lean: true });
      res.status(200).json({ success: true, data: { ok: true } });
    })
  );

  // Products (admin+)
  router.post(
    '/products',
    authenticateAdmin,
    requireAdminRole(['superadmin', 'admin']),
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          name: z.string().min(1),
          slug: z.string().min(1).optional(),
          brandId: z.string().min(1),
          categoryId: z.string().min(1),
          countryOfOrigin: z.string().max(120).optional(),
          productType: z.string().max(120).optional(),
          subcategory: z.string().max(120).optional(),
          ingredients: z.array(z.string().max(120)).max(30).optional(),
          servingSuggestion: z.string().max(500).optional(),
          agingInfo: z.string().max(240).optional(),
          authenticityNote: z.string().max(500).optional(),
          shortDescription: z.string().max(240).optional(),
          tags: z.array(z.string().max(60)).max(25).optional(),
          description: z.string().optional(),
          abv: z.number().min(0).max(100).optional(),
          images: z.array(cloudinaryAssetSchema).max(12).optional(),
          isActive: z.boolean().optional()
        })
        .parse(req.body);

      const brandId = ensureObjectId(body.brandId);
      const categoryId = ensureObjectId(body.categoryId);
      const baseSlug = (body.slug ? makeSlug(body.slug) : makeSlug(body.name)).toLowerCase();
      if (!baseSlug) throw new ApiError(400, 'Invalid slug', { errorCode: 'INVALID_SLUG' });

      const created = await createWithUniqueSlug({
        baseSlug,
        existsFn: async (slug) => (await ProductModel.exists({ slug })) !== null,
        createFn: (slug) =>
          ProductModel.create({
            name: body.name,
            slug,
            brandId,
            categoryId,
            countryOfOrigin: normalizeOptionalText(body.countryOfOrigin),
            productType: normalizeOptionalText(body.productType),
            subcategory: normalizeOptionalText(body.subcategory),
            ingredients: normalizeStringList(body.ingredients),
            servingSuggestion: normalizeOptionalText(body.servingSuggestion),
            agingInfo: normalizeOptionalText(body.agingInfo),
            authenticityNote: normalizeOptionalText(body.authenticityNote),
            shortDescription: normalizeOptionalText(body.shortDescription),
            tags: normalizeStringList(body.tags, { lowercase: true }),
            description: body.description ?? '',
            abv: body.abv,
            images: body.images ?? [],
            isActive: body.isActive ?? true
          })
      });

      res.status(201).json({ success: true, data: created });
    })
  );

  router.put(
    '/products/:id',
    authenticateAdmin,
    requireAdminRole(['superadmin', 'admin']),
    asyncHandler(async (req, res) => {
      const id = ensureObjectId(req.params.id);
      const body = z
        .object({
          name: z.string().min(1).optional(),
          slug: z.string().min(1).optional(),
          brandId: z.string().min(1).optional(),
          categoryId: z.string().min(1).optional(),
          countryOfOrigin: z.string().max(120).nullable().optional(),
          productType: z.string().max(120).nullable().optional(),
          subcategory: z.string().max(120).nullable().optional(),
          ingredients: z.array(z.string().max(120)).max(30).optional(),
          servingSuggestion: z.string().max(500).nullable().optional(),
          agingInfo: z.string().max(240).nullable().optional(),
          authenticityNote: z.string().max(500).nullable().optional(),
          shortDescription: z.string().max(240).nullable().optional(),
          tags: z.array(z.string().max(60)).max(25).optional(),
          description: z.string().optional(),
          abv: z.number().min(0).max(100).nullable().optional(),
          images: z.array(cloudinaryAssetSchema).max(12).optional(),
          isActive: z.boolean().optional()
        })
        .parse(req.body);

      const update: any = {};
      const unset: any = {};
      if (body.name !== undefined) update.name = body.name;
      if (body.slug !== undefined) {
        const slug = makeSlug(body.slug).toLowerCase();
        if (!slug) throw new ApiError(400, 'Invalid slug', { errorCode: 'INVALID_SLUG' });
        const exists = (await ProductModel.exists({ slug, _id: { $ne: id } })) !== null;
        if (exists) throw new ApiError(409, 'Slug already exists', { errorCode: 'SLUG_ALREADY_EXISTS' });
        update.slug = slug;
      }
      if (body.brandId !== undefined) update.brandId = ensureObjectId(body.brandId);
      if (body.categoryId !== undefined) update.categoryId = ensureObjectId(body.categoryId);
      if (body.countryOfOrigin !== undefined) {
        const next = normalizeOptionalText(body.countryOfOrigin);
        if (next === undefined) unset.countryOfOrigin = 1;
        else update.countryOfOrigin = next;
      }
      if (body.productType !== undefined) {
        const next = normalizeOptionalText(body.productType);
        if (next === undefined) unset.productType = 1;
        else update.productType = next;
      }
      if (body.subcategory !== undefined) {
        const next = normalizeOptionalText(body.subcategory);
        if (next === undefined) unset.subcategory = 1;
        else update.subcategory = next;
      }
      if (body.ingredients !== undefined) update.ingredients = normalizeStringList(body.ingredients);
      if (body.servingSuggestion !== undefined) {
        const next = normalizeOptionalText(body.servingSuggestion);
        if (next === undefined) unset.servingSuggestion = 1;
        else update.servingSuggestion = next;
      }
      if (body.agingInfo !== undefined) {
        const next = normalizeOptionalText(body.agingInfo);
        if (next === undefined) unset.agingInfo = 1;
        else update.agingInfo = next;
      }
      if (body.authenticityNote !== undefined) {
        const next = normalizeOptionalText(body.authenticityNote);
        if (next === undefined) unset.authenticityNote = 1;
        else update.authenticityNote = next;
      }
      if (body.shortDescription !== undefined) {
        const next = normalizeOptionalText(body.shortDescription);
        if (next === undefined) unset.shortDescription = 1;
        else update.shortDescription = next;
      }
      if (body.tags !== undefined) update.tags = normalizeStringList(body.tags, { lowercase: true });
      if (body.description !== undefined) update.description = body.description;
      if (body.abv !== undefined) {
        if (body.abv === null) unset.abv = 1;
        else update.abv = body.abv;
      }
      if (body.images !== undefined) update.images = body.images;
      if (body.isActive !== undefined) update.isActive = body.isActive;

      let updated: any;
      try {
        updated = await ProductModel.findByIdAndUpdate(
          id,
          {
            ...(Object.keys(update).length > 0 ? { $set: update } : {}),
            ...(Object.keys(unset).length > 0 ? { $unset: unset } : {})
          },
          { new: true, lean: true }
        );
      } catch (e: any) {
        if (isDuplicateSlugError(e)) {
          throw new ApiError(409, 'Slug already exists', { errorCode: 'SLUG_ALREADY_EXISTS' });
        }
        throw e;
      }
      if (!updated) throw new ApiError(404, 'Product not found', { errorCode: 'NOT_FOUND' });

      if (body.isActive === false) {
        await VariantModel.updateMany({ productId: id }, { $set: { isActive: false } });
      }

      res.status(200).json({ success: true, data: updated });
    })
  );

  router.delete(
    '/products/:id',
    authenticateAdmin,
    requireAdminRole(['superadmin', 'admin']),
    asyncHandler(async (req, res) => {
      const id = ensureObjectId(req.params.id);
      const updated = await ProductModel.findByIdAndUpdate(id, { $set: { isActive: false } }, { new: true, lean: true });
      if (!updated) throw new ApiError(404, 'Product not found', { errorCode: 'NOT_FOUND' });
      await VariantModel.updateMany({ productId: id }, { $set: { isActive: false } });
      res.status(200).json({ success: true, data: { ok: true } });
    })
  );

  // Variants (admin+)
  router.post(
    '/products/:id/variants',
    authenticateAdmin,
    requireAdminRole(['superadmin', 'admin']),
    asyncHandler(async (req, res) => {
      const productId = ensureObjectId(req.params.id);
      const body = z
        .object({
          sku: z.string().min(1),
          label: z.string().max(120).optional(),
          volumeMl: z.number().int().min(1),
          packSize: z.number().int().min(1).optional().default(1),
          price: z.number().int().min(0),
          mrp: z.number().int().min(0).optional(),
          isActive: z.boolean().optional()
        })
        .parse(req.body);

      const product = await ProductModel.findById(productId).select({ _id: 1, isActive: 1 }).lean();
      if (!product) throw new ApiError(404, 'Product not found', { errorCode: 'NOT_FOUND' });

      if ((product as any).isActive === false && (body.isActive ?? true) === true) {
        throw new ApiError(409, 'Product is inactive', { errorCode: 'PRODUCT_INACTIVE' });
      }

      if (body.mrp !== undefined && body.price > body.mrp) {
        throw new ApiError(400, 'Price must be <= MRP', { errorCode: 'PRICE_GT_MRP' });
      }

      const sku = body.sku.trim();
      if (!sku) throw new ApiError(400, 'Invalid SKU', { errorCode: 'INVALID_SKU' });
      const skuExists = (await VariantModel.exists({ sku })) !== null;
      if (skuExists) throw new ApiError(409, 'SKU already exists', { errorCode: 'SKU_ALREADY_EXISTS' });

      let variant: any;
      try {
        variant = await VariantModel.create({
          productId,
          sku,
          label: normalizeOptionalText(body.label),
          volumeMl: body.volumeMl,
          packSize: body.packSize,
          price: body.price,
          mrp: body.mrp,
          isActive: body.isActive ?? true
        });
      } catch (e: any) {
        if (isDuplicateSkuError(e)) {
          throw new ApiError(409, 'SKU already exists', { errorCode: 'SKU_ALREADY_EXISTS' });
        }
        throw e;
      }

      await ensureInventoryStockExists(variant._id);

      res.status(201).json({ success: true, data: variant });
    })
  );

  router.put(
    '/variants/:variantId',
    authenticateAdmin,
    requireAdminRole(['superadmin', 'admin']),
    asyncHandler(async (req, res) => {
      const variantId = ensureObjectId(req.params.variantId);
      const body = z
        .object({
          sku: z.string().min(1).optional(),
          label: z.string().max(120).nullable().optional(),
          volumeMl: z.number().int().min(1).optional(),
          packSize: z.number().int().min(1).optional(),
          price: z.number().int().min(0).optional(),
          mrp: z.number().int().min(0).nullable().optional(),
          isActive: z.boolean().optional()
        })
        .parse(req.body);

      const existing = (await VariantModel.findById(variantId).lean().exec()) as any;
      if (!existing) throw new ApiError(404, 'Variant not found', { errorCode: 'NOT_FOUND' });

      const nextPrice = body.price !== undefined ? body.price : Number(existing.price ?? 0);
      const nextMrp =
        body.mrp !== undefined ? (body.mrp ?? undefined) : (existing.mrp !== undefined ? Number(existing.mrp) : undefined);
      if (nextMrp !== undefined && nextPrice > nextMrp) {
        throw new ApiError(400, 'Price must be <= MRP', { errorCode: 'PRICE_GT_MRP' });
      }

      if (body.isActive === true) {
        const parent = await ProductModel.findById(existing.productId).select({ isActive: 1 }).lean().exec();
        if (!parent) throw new ApiError(404, 'Product not found', { errorCode: 'NOT_FOUND' });
        if ((parent as any).isActive === false) throw new ApiError(409, 'Product is inactive', { errorCode: 'PRODUCT_INACTIVE' });
      }

      const update: any = {};
      const unset: any = {};
      if (body.sku !== undefined) {
        const sku = body.sku.trim();
        if (!sku) throw new ApiError(400, 'Invalid SKU', { errorCode: 'INVALID_SKU' });
        const exists = (await VariantModel.exists({ sku, _id: { $ne: variantId } })) !== null;
        if (exists) throw new ApiError(409, 'SKU already exists', { errorCode: 'SKU_ALREADY_EXISTS' });
        update.sku = sku;
      }
      if (body.label !== undefined) {
        const next = normalizeOptionalText(body.label);
        if (next === undefined) unset.label = 1;
        else update.label = next;
      }
      if (body.volumeMl !== undefined) update.volumeMl = body.volumeMl;
      if (body.packSize !== undefined) update.packSize = body.packSize;
      if (body.price !== undefined) update.price = body.price;
      if (body.mrp !== undefined) {
        if (body.mrp === null) unset.mrp = 1;
        else update.mrp = body.mrp;
      }
      if (body.isActive !== undefined) update.isActive = body.isActive;

      let updated: any;
      try {
        updated = await VariantModel.findByIdAndUpdate(
          variantId,
          {
            ...(Object.keys(update).length > 0 ? { $set: update } : {}),
            ...(Object.keys(unset).length > 0 ? { $unset: unset } : {})
          },
          { new: true, lean: true }
        );
      } catch (e: any) {
        if (isDuplicateSkuError(e)) {
          throw new ApiError(409, 'SKU already exists', { errorCode: 'SKU_ALREADY_EXISTS' });
        }
        throw e;
      }
      if (!updated) throw new ApiError(404, 'Variant not found', { errorCode: 'NOT_FOUND' });

      await ensureInventoryStockExists(variantId);

      res.status(200).json({ success: true, data: updated });
    })
  );

  router.delete(
    '/variants/:variantId',
    authenticateAdmin,
    requireAdminRole(['superadmin', 'admin']),
    asyncHandler(async (req, res) => {
      const variantId = ensureObjectId(req.params.variantId);
      const updated = await VariantModel.findByIdAndUpdate(variantId, { $set: { isActive: false } }, { new: true, lean: true });
      if (!updated) throw new ApiError(404, 'Variant not found', { errorCode: 'NOT_FOUND' });
      res.status(200).json({ success: true, data: { ok: true } });
    })
  );

  return router;
}
