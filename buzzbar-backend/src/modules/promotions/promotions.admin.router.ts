import { Router } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { asyncHandler } from '../../common/utils/async_handler.js';
import { ApiError } from '../../common/middleware/error_handler.js';
import { authenticateAdmin, requireAdminRole } from '../admin/admin.middleware.js';
import { BrandModel, CategoryModel, ProductModel } from '../catalog/catalog.models.js';
import { PromotionModel, PromoUsageModel } from './promotions.models.js';

const PROMO_READ_ROLES = ['superadmin', 'admin', 'employee'] as const;
const PROMO_MANAGE_ROLES = ['superadmin', 'admin'] as const;

type PromoStatus = 'live' | 'scheduled' | 'expired' | 'inactive';
type PromoValidityStatus = PromoStatus | 'invalid';

const promoWriteSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(3)
      .max(40)
      .regex(/^[A-Za-z0-9_-]+$/, 'Code must contain only letters, numbers, hyphens, or underscores'),
    title: z.string().trim().min(1).max(140),
    description: z.string().trim().max(2000).optional().nullable(),
    type: z.enum(['PERCENT', 'FLAT']),
    value: z.coerce.number().positive(),
    minSubtotal: z.coerce.number().int().min(0).optional().nullable(),
    maxDiscount: z.coerce.number().int().min(0).optional().nullable(),
    usageLimitTotal: z.coerce.number().int().min(0).optional().nullable(),
    usageLimitPerUser: z.coerce.number().int().min(0).optional().nullable(),
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    isActive: z.boolean().default(true),
    eligibleCategoryIds: z.array(z.string()).optional().default([]),
    eligibleBrandIds: z.array(z.string()).optional().default([]),
    eligibleProductIds: z.array(z.string()).optional().default([]),
    excludeDiscountedItems: z.boolean().default(false)
  })
  .superRefine((value, ctx) => {
    const startAt = new Date(value.startAt);
    const endAt = new Date(value.endAt);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || startAt.getTime() >= endAt.getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'startAt must be before endAt',
        path: ['endAt']
      });
    }

    if (value.type === 'PERCENT' && value.value > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Percentage discount cannot exceed 100',
        path: ['value']
      });
    }
  });

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeCode(value: string) {
  return value.trim().toUpperCase();
}

function asObjectIds(ids: string[]) {
  const normalized = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
  for (const id of normalized) {
    if (!mongoose.isValidObjectId(id)) {
      throw new ApiError(400, 'Invalid promotion eligibility id', { errorCode: 'INVALID_ID', details: { id } });
    }
  }
  return normalized.map((id) => new mongoose.Types.ObjectId(id));
}

function isDuplicateCodeError(error: any) {
  return error?.code === 11000 && (error?.keyPattern?.code || error?.keyValue?.code);
}

async function ensurePromotionCodeAvailable(code: string, excludePromotionId?: mongoose.Types.ObjectId | string) {
  const existing = await PromotionModel.findOne({ code })
    .select('_id')
    .exec();

  if (!existing) return;

  if (excludePromotionId && existing._id.toString() === excludePromotionId.toString()) {
    return;
  }

  throw new ApiError(409, 'Promotion code already exists', { errorCode: 'PROMO_CODE_ALREADY_EXISTS' });
}

function parseDateInput(raw: string, bound: 'from' | 'to') {
  const trimmed = raw.trim();
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  if (bound === 'to' && /^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    parsed.setUTCDate(parsed.getUTCDate() + 1);
  }
  return parsed;
}

function promoStatus(promotion: { isActive?: boolean; startAt?: Date | string | null; endAt?: Date | string | null }, now: Date): PromoStatus {
  if (!promotion?.isActive) return 'inactive';
  const startAt = promotion.startAt ? new Date(promotion.startAt) : null;
  const endAt = promotion.endAt ? new Date(promotion.endAt) : null;
  if (startAt && startAt.getTime() > now.getTime()) return 'scheduled';
  if (endAt && endAt.getTime() < now.getTime()) return 'expired';
  return 'live';
}

function promoResponseShape(promotion: any, now: Date) {
  const status = promoStatus(promotion, now);
  return {
    id: promotion._id?.toString?.() ?? String(promotion.id),
    code: promotion.code,
    title: promotion.title ?? null,
    description: promotion.description ?? null,
    type: promotion.type,
    value: promotion.value,
    isActive: Boolean(promotion.isActive),
    status,
    startAt: promotion.startAt?.toISOString?.() ?? new Date(promotion.startAt).toISOString(),
    endAt: promotion.endAt?.toISOString?.() ?? new Date(promotion.endAt).toISOString(),
    minSubtotal: promotion.minSubtotal ?? null,
    maxDiscount: promotion.maxDiscount ?? null,
    usageLimitTotal: promotion.usageLimitTotal ?? null,
    usageLimitPerUser: promotion.usageLimitPerUser ?? null,
    usageCount: Number(promotion.usageCount ?? 0),
    usageRemaining:
      typeof promotion.usageLimitTotal === 'number' ? Math.max(0, Number(promotion.usageLimitTotal) - Number(promotion.usageCount ?? 0)) : null,
    isExhausted: typeof promotion.usageLimitTotal === 'number' ? Number(promotion.usageCount ?? 0) >= Number(promotion.usageLimitTotal) : false,
    eligibleCategoryIds: Array.isArray(promotion.eligibleCategoryIds) ? promotion.eligibleCategoryIds.map((id: any) => id?.toString?.() ?? String(id)) : [],
    eligibleBrandIds: Array.isArray(promotion.eligibleBrandIds) ? promotion.eligibleBrandIds.map((id: any) => id?.toString?.() ?? String(id)) : [],
    eligibleProductIds: Array.isArray(promotion.eligibleProductIds) ? promotion.eligibleProductIds.map((id: any) => id?.toString?.() ?? String(id)) : [],
    excludeDiscountedItems: Boolean(promotion.excludeDiscountedItems),
    createdAt: promotion.createdAt?.toISOString?.() ?? new Date(promotion.createdAt).toISOString(),
    updatedAt: promotion.updatedAt?.toISOString?.() ?? new Date(promotion.updatedAt).toISOString()
  };
}

function buildPromoValidation(promotion: any, now: Date) {
  const warnings: string[] = [];
  const invalidReasons: string[] = [];
  const checkoutHints: string[] = [];
  const startAt = new Date(promotion.startAt);
  const endAt = new Date(promotion.endAt);
  const usageCount = Number(promotion.usageCount ?? 0);
  const usageLimitTotal = typeof promotion.usageLimitTotal === 'number' ? Number(promotion.usageLimitTotal) : null;

  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || startAt.getTime() >= endAt.getTime()) {
    invalidReasons.push('Active window is invalid because start time is not before end time.');
  }
  if (promotion.type === 'PERCENT' && Number(promotion.value) > 100) {
    invalidReasons.push('Percent discounts cannot exceed 100%.');
  }
  if (Number(promotion.value) <= 0) {
    invalidReasons.push('Discount value must be greater than zero.');
  }
  if (promotion.minSubtotal != null && Number(promotion.minSubtotal) < 0) {
    invalidReasons.push('Minimum order amount cannot be negative.');
  }
  if (promotion.maxDiscount != null && Number(promotion.maxDiscount) < 0) {
    invalidReasons.push('Maximum discount cap cannot be negative.');
  }
  if (usageLimitTotal != null && usageCount >= usageLimitTotal) {
    warnings.push('Total usage limit has been exhausted.');
    checkoutHints.push('This promo will fail at checkout because the total usage limit is already exhausted.');
  }
  if (!promotion.isActive) {
    warnings.push('Promotion is inactive and will not apply until it is re-enabled.');
    checkoutHints.push('This promo will fail at checkout because it is manually inactive.');
  }
  if (!Number.isNaN(startAt.getTime()) && startAt.getTime() > now.getTime()) {
    warnings.push('Promotion has not started yet.');
    checkoutHints.push('This promo will fail at checkout until its start time is reached.');
  }
  if (!Number.isNaN(endAt.getTime()) && endAt.getTime() < now.getTime()) {
    warnings.push('Promotion has already expired.');
    checkoutHints.push('This promo will fail at checkout because the active window has ended.');
  }
  if (promotion.minSubtotal != null && Number(promotion.minSubtotal) > 0) {
    checkoutHints.push(`Orders below NPR ${Math.trunc(Number(promotion.minSubtotal))} will not qualify.`);
  }
  if (promotion.usageLimitPerUser != null && Number(promotion.usageLimitPerUser) > 0) {
    checkoutHints.push(`Each user can redeem this promo at most ${Math.trunc(Number(promotion.usageLimitPerUser))} times.`);
  }
  if (promotion.excludeDiscountedItems) {
    checkoutHints.push('Discounted catalog items are excluded from this promo.');
  }
  if ((promotion.eligibleCategoryIds?.length ?? 0) > 0 || (promotion.eligibleBrandIds?.length ?? 0) > 0 || (promotion.eligibleProductIds?.length ?? 0) > 0) {
    checkoutHints.push('Only the configured eligible catalog items will qualify.');
  }

  const invalidConfiguration = invalidReasons.length > 0;
  let liveValidityStatus: PromoValidityStatus = promoStatus(promotion, now);
  if (invalidConfiguration) liveValidityStatus = 'invalid';

  return {
    liveValidityStatus,
    warnings,
    checkoutHints,
    invalidConfiguration,
    invalidReasons
  };
}

function formatNpr(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return 'No minimum order requirement';
  return `Minimum order NPR ${Math.trunc(value)}`;
}

function buildReadableBlocks(promotion: any) {
  const audienceParts: string[] = [];
  if ((promotion.eligibleCategoryIds?.length ?? 0) > 0) audienceParts.push(`${promotion.eligibleCategoryIds.length} category restriction${promotion.eligibleCategoryIds.length === 1 ? '' : 's'}`);
  if ((promotion.eligibleBrandIds?.length ?? 0) > 0) audienceParts.push(`${promotion.eligibleBrandIds.length} brand restriction${promotion.eligibleBrandIds.length === 1 ? '' : 's'}`);
  if ((promotion.eligibleProductIds?.length ?? 0) > 0) audienceParts.push(`${promotion.eligibleProductIds.length} product restriction${promotion.eligibleProductIds.length === 1 ? '' : 's'}`);

  return {
    audience: audienceParts.length > 0 ? `Eligible only for ${audienceParts.join(', ')}.` : 'Eligible for all customers and all catalog items unless other limits block it.',
    schedule: `${new Date(promotion.startAt).toISOString()} → ${new Date(promotion.endAt).toISOString()}`,
    minOrderAmount: formatNpr(promotion.minSubtotal),
    capExclusionsLimits: [
      promotion.type === 'PERCENT' ? `${Math.trunc(Number(promotion.value ?? 0))}% off` : `Flat NPR ${Math.trunc(Number(promotion.value ?? 0))} off`,
      promotion.maxDiscount != null ? `Maximum discount cap NPR ${Math.trunc(Number(promotion.maxDiscount))}` : 'No maximum discount cap',
      promotion.usageLimitTotal != null ? `Total usage limit ${Math.trunc(Number(promotion.usageLimitTotal))}` : 'No total usage cap',
      promotion.usageLimitPerUser != null ? `Per-user limit ${Math.trunc(Number(promotion.usageLimitPerUser))}` : 'No per-user limit',
      promotion.excludeDiscountedItems ? 'Already discounted items are excluded' : 'Discounted items are allowed'
    ]
  };
}

async function resolveEligibilityEntities(promotion: any) {
  const [categories, brands, products] = await Promise.all([
    promotion.eligibleCategoryIds?.length
      ? CategoryModel.find({ _id: { $in: promotion.eligibleCategoryIds } })
          .select('_id name slug isActive')
          .lean()
          .exec()
      : Promise.resolve([]),
    promotion.eligibleBrandIds?.length
      ? BrandModel.find({ _id: { $in: promotion.eligibleBrandIds } })
          .select('_id name slug isActive')
          .lean()
          .exec()
      : Promise.resolve([]),
    promotion.eligibleProductIds?.length
      ? ProductModel.find({ _id: { $in: promotion.eligibleProductIds } })
          .select('_id name slug isActive')
          .lean()
          .exec()
      : Promise.resolve([])
  ]);

  return {
    categories: categories.map((item: any) => ({
      id: item._id.toString(),
      name: item.name,
      slug: item.slug,
      isActive: Boolean(item.isActive)
    })),
    brands: brands.map((item: any) => ({
      id: item._id.toString(),
      name: item.name,
      slug: item.slug,
      isActive: Boolean(item.isActive)
    })),
    products: products.map((item: any) => ({
      id: item._id.toString(),
      name: item.name,
      slug: item.slug,
      isActive: Boolean(item.isActive)
    }))
  };
}

async function promoDetailResponseShape(promotion: any, now: Date) {
  const base = promoResponseShape(promotion, now);
  const validation = buildPromoValidation(promotion, now);
  const readable = buildReadableBlocks(promotion);
  const eligibilityEntities = await resolveEligibilityEntities(promotion);

  return {
    ...base,
    eligibilitySummary: {
      whoCanUseIt: readable.audience,
      whenItApplies: readable.schedule,
      minOrderAmount: readable.minOrderAmount,
      capExclusionsLimits: readable.capExclusionsLimits,
      categories: eligibilityEntities.categories,
      brands: eligibilityEntities.brands,
      products: eligibilityEntities.products
    },
    usageSummary: {
      totalRedemptions: base.usageCount,
      remainingUses: base.usageRemaining,
      perUserLimit: base.usageLimitPerUser,
      totalLimit: base.usageLimitTotal,
      isExhausted: base.isExhausted,
      exhaustedStateLabel: base.isExhausted ? 'Usage cap exhausted' : null
    },
    validation,
    linkedBusinessRules: {
      minSubtotal: base.minSubtotal,
      maxDiscount: base.maxDiscount,
      excludeDiscountedItems: base.excludeDiscountedItems,
      eligibleCategories: eligibilityEntities.categories,
      eligibleBrands: eligibilityEntities.brands,
      eligibleProducts: eligibilityEntities.products
    }
  };
}

function buildWritePayload(input: z.infer<typeof promoWriteSchema>) {
  return {
    code: normalizeCode(input.code),
    title: input.title.trim(),
    description: input.description?.trim() ? input.description.trim() : undefined,
    type: input.type,
    value: Math.trunc(input.value),
    minSubtotal: input.minSubtotal ?? undefined,
    maxDiscount: input.maxDiscount ?? undefined,
    usageLimitTotal: input.usageLimitTotal ?? undefined,
    usageLimitPerUser: input.usageLimitPerUser ?? undefined,
    startAt: new Date(input.startAt),
    endAt: new Date(input.endAt),
    isActive: input.isActive,
    eligibleCategoryIds: asObjectIds(input.eligibleCategoryIds),
    eligibleBrandIds: asObjectIds(input.eligibleBrandIds),
    eligibleProductIds: asObjectIds(input.eligibleProductIds),
    excludeDiscountedItems: input.excludeDiscountedItems
  };
}

function buildPromoMatch(opts: {
  q?: string;
  type?: 'PERCENT' | 'FLAT' | 'all';
  isActive?: 'active' | 'inactive' | 'all';
  state?: 'live' | 'scheduled' | 'expired' | 'inactive' | 'all';
  from?: Date | null;
  to?: Date | null;
  now: Date;
}) {
  const andClauses: Record<string, unknown>[] = [];

  if (opts.q) {
    const regex = new RegExp(escapeRegex(opts.q), 'i');
    andClauses.push({ $or: [{ code: regex }, { title: regex }] });
  }

  if (opts.type && opts.type !== 'all') {
    andClauses.push({ type: opts.type });
  }

  if (opts.isActive === 'active') andClauses.push({ isActive: true });
  if (opts.isActive === 'inactive') andClauses.push({ isActive: false });

  if (opts.from) andClauses.push({ endAt: { $gte: opts.from } });
  if (opts.to) andClauses.push({ startAt: { $lt: opts.to } });

  if (opts.state === 'inactive') {
    andClauses.push({ isActive: false });
  } else if (opts.state === 'scheduled') {
    andClauses.push({ isActive: true, startAt: { $gt: opts.now } });
  } else if (opts.state === 'expired') {
    andClauses.push({ isActive: true, endAt: { $lt: opts.now } });
  } else if (opts.state === 'live') {
    andClauses.push({ isActive: true, startAt: { $lte: opts.now }, endAt: { $gte: opts.now } });
  }

  if (andClauses.length === 0) return {};
  if (andClauses.length === 1) return andClauses[0] as Record<string, unknown>;
  return { $and: andClauses };
}

function usageLookupStages() {
  return [
    {
      $lookup: {
        from: PromoUsageModel.collection.name,
        localField: '_id',
        foreignField: 'promoId',
        as: 'promoUsages'
      }
    },
    {
      $addFields: {
        usageCount: { $sum: '$promoUsages.usedCount' }
      }
    }
  ];
}

export function promotionsAdminRouter() {
  const router = Router();

  router.get(
    '/promotions',
    authenticateAdmin,
    requireAdminRole([...PROMO_READ_ROLES]),
    asyncHandler(async (req, res) => {
      const query = z
        .object({
          q: z.string().optional(),
          type: z.enum(['PERCENT', 'FLAT', 'all']).default('all'),
          isActive: z.enum(['active', 'inactive', 'all']).default('all'),
          state: z.enum(['live', 'scheduled', 'expired', 'inactive', 'all']).default('all'),
          from: z.string().optional(),
          to: z.string().optional(),
          sort: z.enum(['createdAt_desc', 'createdAt_asc', 'updatedAt_desc', 'startsAt_asc', 'endsAt_asc', 'usageCount_desc']).default('createdAt_desc'),
          page: z.coerce.number().int().positive().default(1),
          limit: z.coerce.number().int().positive().max(100).default(20)
        })
        .parse(req.query ?? {});

      const limitAllowed = new Set([20, 50, 100]);
      if (!limitAllowed.has(query.limit)) {
        throw new ApiError(400, 'Invalid limit', { errorCode: 'INVALID_LIMIT', details: { allowed: [...limitAllowed] } });
      }

      const from = query.from ? parseDateInput(query.from, 'from') : null;
      const to = query.to ? parseDateInput(query.to, 'to') : null;
      if (query.from && !from) throw new ApiError(400, 'Invalid from date', { errorCode: 'INVALID_DATE' });
      if (query.to && !to) throw new ApiError(400, 'Invalid to date', { errorCode: 'INVALID_DATE' });

      const now = new Date();
      const match = buildPromoMatch({
        q: query.q?.trim() || undefined,
        type: query.type,
        isActive: query.isActive,
        state: query.state,
        from,
        to,
        now
      });

      const sortMap: Record<string, Record<string, 1 | -1>> = {
        createdAt_desc: { createdAt: -1, _id: -1 },
        createdAt_asc: { createdAt: 1, _id: 1 },
        updatedAt_desc: { updatedAt: -1, _id: -1 },
        startsAt_asc: { startAt: 1, _id: 1 },
        endsAt_asc: { endAt: 1, _id: 1 },
        usageCount_desc: { usageCount: -1, createdAt: -1, _id: -1 }
      };

      const skip = (query.page - 1) * query.limit;
      const [items, total] = await Promise.all([
        PromotionModel.aggregate([
          { $match: match },
          ...usageLookupStages(),
          { $sort: sortMap[query.sort] },
          { $skip: skip },
          { $limit: query.limit },
          {
            $project: {
              code: 1,
              title: 1,
              type: 1,
              value: 1,
              isActive: 1,
              startAt: 1,
              endAt: 1,
              minSubtotal: 1,
              maxDiscount: 1,
              usageLimitTotal: 1,
              usageLimitPerUser: 1,
              usageCount: { $ifNull: ['$usageCount', 0] },
              createdAt: 1,
              updatedAt: 1
            }
          }
        ]).exec(),
        PromotionModel.countDocuments(match)
      ]);

      res.status(200).json({
        success: true,
        data: {
          items: items.map((promotion: any) => promoResponseShape(promotion, now)),
          page: query.page,
          limit: query.limit,
          total
        }
      });
    })
  );

  router.get(
    '/promotions/:id',
    authenticateAdmin,
    requireAdminRole([...PROMO_READ_ROLES]),
    asyncHandler(async (req, res) => {
      const params = z.object({ id: z.string().min(1) }).parse(req.params);
      if (!mongoose.isValidObjectId(params.id)) {
        throw new ApiError(404, 'Promotion not found', { errorCode: 'NOT_FOUND' });
      }

      const [promotion, usage] = await Promise.all([
        PromotionModel.findById(params.id).lean().exec(),
        PromoUsageModel.aggregate([
          { $match: { promoId: new mongoose.Types.ObjectId(params.id) } },
          { $group: { _id: '$promoId', usageCount: { $sum: '$usedCount' } } }
        ]).exec()
      ]);

      if (!promotion) throw new ApiError(404, 'Promotion not found', { errorCode: 'NOT_FOUND' });

      const usageCount = Number(usage[0]?.usageCount ?? 0);
      const now = new Date();
      res.status(200).json({
        success: true,
        data: await promoDetailResponseShape({ ...promotion, usageCount }, now)
      });
    })
  );

  router.post(
    '/promotions',
    authenticateAdmin,
    requireAdminRole([...PROMO_MANAGE_ROLES]),
    asyncHandler(async (req, res) => {
      const parsed = promoWriteSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new ApiError(400, 'Invalid promotion payload', { errorCode: 'VALIDATION_ERROR', details: parsed.error.flatten() });
      }

      try {
        const payload = buildWritePayload(parsed.data);
        await ensurePromotionCodeAvailable(payload.code);
        const promotion = await PromotionModel.create(payload as any);
        res.status(201).json({
          success: true,
          data: promoResponseShape({ ...promotion.toObject(), usageCount: 0 }, new Date())
        });
      } catch (error: any) {
        if (isDuplicateCodeError(error)) {
          throw new ApiError(409, 'Promotion code already exists', { errorCode: 'PROMO_CODE_ALREADY_EXISTS' });
        }
        throw error;
      }
    })
  );

  router.put(
    '/promotions/:id',
    authenticateAdmin,
    requireAdminRole([...PROMO_MANAGE_ROLES]),
    asyncHandler(async (req, res) => {
      const params = z.object({ id: z.string().min(1) }).parse(req.params);
      if (!mongoose.isValidObjectId(params.id)) {
        throw new ApiError(404, 'Promotion not found', { errorCode: 'NOT_FOUND' });
      }

      const parsed = promoWriteSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new ApiError(400, 'Invalid promotion payload', { errorCode: 'VALIDATION_ERROR', details: parsed.error.flatten() });
      }

      const promotion = await PromotionModel.findById(params.id).exec();
      if (!promotion) throw new ApiError(404, 'Promotion not found', { errorCode: 'NOT_FOUND' });

      try {
        const payload = buildWritePayload(parsed.data);
        await ensurePromotionCodeAvailable(payload.code, promotion._id);
        promotion.code = payload.code;
        promotion.title = payload.title;
        promotion.description = payload.description;
        promotion.type = payload.type;
        promotion.value = payload.value;
        promotion.minSubtotal = payload.minSubtotal;
        promotion.maxDiscount = payload.maxDiscount;
        promotion.usageLimitTotal = payload.usageLimitTotal;
        promotion.usageLimitPerUser = payload.usageLimitPerUser;
        promotion.startAt = payload.startAt;
        promotion.endAt = payload.endAt;
        promotion.isActive = payload.isActive;
        (promotion as any).eligibleCategoryIds = payload.eligibleCategoryIds;
        (promotion as any).eligibleBrandIds = payload.eligibleBrandIds;
        (promotion as any).eligibleProductIds = payload.eligibleProductIds;
        (promotion as any).excludeDiscountedItems = payload.excludeDiscountedItems;
        await promotion.save();

        const usage = await PromoUsageModel.aggregate([
          { $match: { promoId: promotion._id } },
          { $group: { _id: '$promoId', usageCount: { $sum: '$usedCount' } } }
        ]).exec();

        res.status(200).json({
          success: true,
          data: promoResponseShape({ ...promotion.toObject(), usageCount: Number(usage[0]?.usageCount ?? 0) }, new Date())
        });
      } catch (error: any) {
        if (isDuplicateCodeError(error)) {
          throw new ApiError(409, 'Promotion code already exists', { errorCode: 'PROMO_CODE_ALREADY_EXISTS' });
        }
        throw error;
      }
    })
  );

  router.delete(
    '/promotions/:id',
    authenticateAdmin,
    requireAdminRole([...PROMO_MANAGE_ROLES]),
    asyncHandler(async (req, res) => {
      const params = z.object({ id: z.string().min(1) }).parse(req.params);
      if (!mongoose.isValidObjectId(params.id)) {
        throw new ApiError(404, 'Promotion not found', { errorCode: 'NOT_FOUND' });
      }

      const promotion = await PromotionModel.findById(params.id).exec();
      if (!promotion) throw new ApiError(404, 'Promotion not found', { errorCode: 'NOT_FOUND' });

      promotion.isActive = false;
      await promotion.save();

      const usage = await PromoUsageModel.aggregate([
        { $match: { promoId: promotion._id } },
        { $group: { _id: '$promoId', usageCount: { $sum: '$usedCount' } } }
      ]).exec();

      res.status(200).json({
        success: true,
        data: promoResponseShape({ ...promotion.toObject(), usageCount: Number(usage[0]?.usageCount ?? 0) }, new Date())
      });
    })
  );

  return router;
}
