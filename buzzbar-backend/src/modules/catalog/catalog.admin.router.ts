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

function ensureObjectId(id: string) {
  if (!mongoose.isValidObjectId(id)) throw new ApiError(400, 'Invalid id', { errorCode: 'INVALID_ID' });
  return new mongoose.Types.ObjectId(id);
}

function isDuplicateSlugError(err: any) {
  return err?.code === 11000 && (err?.keyPattern?.slug || err?.keyValue?.slug);
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
  throw new ApiError(409, 'Slug collision', { errorCode: 'SLUG_COLLISION' });
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
          sortOrder: z.number().int().optional(),
          isActive: z.boolean().optional()
        })
        .parse(req.body);

      const update: any = {};
      if (body.name !== undefined) update.name = body.name;
      if (body.slug !== undefined) {
        const slug = makeSlug(body.slug);
        if (!slug) throw new ApiError(400, 'Invalid slug', { errorCode: 'INVALID_SLUG' });
        update.slug = slug;
      }
      if (body.sortOrder !== undefined) update.sortOrder = body.sortOrder;
      if (body.isActive !== undefined) update.isActive = body.isActive;

      const updated = await CategoryModel.findByIdAndUpdate(id, { $set: update }, { new: true, lean: true });
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
      const updated = await CategoryModel.findByIdAndUpdate(id, { $set: { isActive: false } }, { new: true, lean: true });
      if (!updated) throw new ApiError(404, 'Category not found', { errorCode: 'NOT_FOUND' });
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

      const update: any = {};
      if (body.name !== undefined) update.name = body.name;
      if (body.slug !== undefined) {
        const slug = makeSlug(body.slug);
        if (!slug) throw new ApiError(400, 'Invalid slug', { errorCode: 'INVALID_SLUG' });
        update.slug = slug;
      }
      if (body.logo !== undefined) update.logo = body.logo ?? undefined;
      if (body.isActive !== undefined) update.isActive = body.isActive;

      const updated = await BrandModel.findByIdAndUpdate(id, { $set: update }, { new: true, lean: true });
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
      const updated = await BrandModel.findByIdAndUpdate(id, { $set: { isActive: false } }, { new: true, lean: true });
      if (!updated) throw new ApiError(404, 'Brand not found', { errorCode: 'NOT_FOUND' });
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
          description: z.string().optional(),
          abv: z.number().min(0).max(100).nullable().optional(),
          images: z.array(cloudinaryAssetSchema).max(12).optional(),
          isActive: z.boolean().optional()
        })
        .parse(req.body);

      const update: any = {};
      if (body.name !== undefined) update.name = body.name;
      if (body.slug !== undefined) {
        const slug = makeSlug(body.slug);
        if (!slug) throw new ApiError(400, 'Invalid slug', { errorCode: 'INVALID_SLUG' });
        update.slug = slug;
      }
      if (body.brandId !== undefined) update.brandId = ensureObjectId(body.brandId);
      if (body.categoryId !== undefined) update.categoryId = ensureObjectId(body.categoryId);
      if (body.description !== undefined) update.description = body.description;
      if (body.abv !== undefined) update.abv = body.abv ?? undefined;
      if (body.images !== undefined) update.images = body.images;
      if (body.isActive !== undefined) update.isActive = body.isActive;

      const updated = await ProductModel.findByIdAndUpdate(id, { $set: update }, { new: true, lean: true });
      if (!updated) throw new ApiError(404, 'Product not found', { errorCode: 'NOT_FOUND' });
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
          volumeMl: z.number().int().min(1),
          packSize: z.number().int().min(1),
          price: z.number().int().min(0),
          mrp: z.number().int().min(0).optional(),
          isActive: z.boolean().optional()
        })
        .parse(req.body);

      const product = await ProductModel.findById(productId).select({ _id: 1 }).lean();
      if (!product) throw new ApiError(404, 'Product not found', { errorCode: 'NOT_FOUND' });

      const variant = await VariantModel.create({
        productId,
        sku: body.sku,
        volumeMl: body.volumeMl,
        packSize: body.packSize,
        price: body.price,
        mrp: body.mrp,
        isActive: body.isActive ?? true
      });

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
          volumeMl: z.number().int().min(1).optional(),
          packSize: z.number().int().min(1).optional(),
          price: z.number().int().min(0).optional(),
          mrp: z.number().int().min(0).nullable().optional(),
          isActive: z.boolean().optional()
        })
        .parse(req.body);

      const update: any = {};
      if (body.sku !== undefined) update.sku = body.sku;
      if (body.volumeMl !== undefined) update.volumeMl = body.volumeMl;
      if (body.packSize !== undefined) update.packSize = body.packSize;
      if (body.price !== undefined) update.price = body.price;
      if (body.mrp !== undefined) update.mrp = body.mrp ?? undefined;
      if (body.isActive !== undefined) update.isActive = body.isActive;

      const updated = await VariantModel.findByIdAndUpdate(variantId, { $set: update }, { new: true, lean: true });
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
