import mongoose from 'mongoose';
import { PromotionModel, PromoUsageModel } from './promotions.models.js';
import { VariantModel } from '../catalog/catalog.models.js';
import { computeCartSummary } from '../cart/cart.service.js';

function floorInt(n: number) {
  return Math.floor(n);
}

function normalizeCode(code: string) {
  return code.trim().toUpperCase();
}

function asObjectIds(ids: unknown): mongoose.Types.ObjectId[] {
  if (!Array.isArray(ids)) return [];
  return ids
    .map((v) => (mongoose.isValidObjectId(String(v)) ? new mongoose.Types.ObjectId(String(v)) : null))
    .filter(Boolean) as mongoose.Types.ObjectId[];
}

function isDiscountedItem(v: any) {
  const mrp = typeof v.mrp === 'number' ? v.mrp : undefined;
  const price = typeof v.price === 'number' ? v.price : undefined;
  return mrp !== undefined && price !== undefined && price < mrp;
}

export type PromoValidateInput =
  | { code: string; userId: string; mode: 'cart' }
  | { code: string; userId: string; mode: 'items'; items: { variantId: string; qty: number }[] };

export type PromoValidateOutput = {
  isValid: boolean;
  reasons: string[];
  subtotal: number;
  discountAmount: number;
  maxDiscountApplied?: boolean;
  newTotal: number;
};

async function getUsageCounts(opts: { promoId: mongoose.Types.ObjectId; userId: mongoose.Types.ObjectId }) {
  const [perUser, totalAgg] = await Promise.all([
    PromoUsageModel.findOne({ promoId: opts.promoId, userId: opts.userId }).lean().exec(),
    PromoUsageModel.aggregate([{ $match: { promoId: opts.promoId } }, { $group: { _id: '$promoId', total: { $sum: '$usedCount' } } }])
  ]);
  const perUserUsed = Number((perUser as any)?.usedCount ?? 0);
  const totalUsed = Number(totalAgg?.[0]?.total ?? 0);
  return { perUserUsed, totalUsed };
}

export async function validatePromotion(input: PromoValidateInput): Promise<PromoValidateOutput> {
  const code = normalizeCode(input.code);
  const reasons: string[] = [];

  const userId = new mongoose.Types.ObjectId(input.userId);

  let subtotal = 0;
  let items: { variantId: string; qty: number; price: number; mrp?: number; productId: any }[] = [];

  if (input.mode === 'cart') {
    const summary = await computeCartSummary(input.userId);
    subtotal = summary?.subtotal ?? 0;
    items = (summary?.expandedItems ?? []).map((it) => ({
      variantId: it.variantId,
      qty: it.qty,
      price: it.variant.price,
      mrp: it.variant.mrp,
      productId: {
        _id: it.product.id,
        brandId: it.product.brandId,
        categoryId: it.product.categoryId
      }
    }));
  } else {
    const variantIds = [...new Set(input.items.map((i) => i.variantId))].filter((v) => mongoose.isValidObjectId(v));
    const variants = await VariantModel.find({ _id: { $in: variantIds } })
      .populate('productId', { brandId: 1, categoryId: 1 })
      .lean();
    const byId = new Map<string, any>(variants.map((v: any) => [v._id.toString(), v]));
    for (const it of input.items) {
      if (!mongoose.isValidObjectId(it.variantId)) continue;
      const v = byId.get(it.variantId);
      if (!v) continue;
      const qty = Math.max(0, Math.trunc(it.qty));
      if (qty <= 0) continue;
      const line = qty * Math.trunc(v.price);
      subtotal += line;
      items.push({
        variantId: v._id.toString(),
        qty,
        price: Math.trunc(v.price),
        mrp: v.mrp ?? undefined,
        productId: v.productId
      });
    }
  }

  const promo = (await PromotionModel.findOne({ code }).lean().exec()) as any | null;
  if (!promo) {
    return { isValid: false, reasons: ['PROMO_NOT_FOUND'], subtotal, discountAmount: 0, newTotal: subtotal };
  }

  const now = new Date();
  if (!promo.isActive) reasons.push('PROMO_INACTIVE');
  if (promo.startAt && now.getTime() < new Date(promo.startAt).getTime()) reasons.push('PROMO_NOT_STARTED');
  if (promo.endAt && now.getTime() > new Date(promo.endAt).getTime()) reasons.push('PROMO_EXPIRED');

  const usage = await getUsageCounts({ promoId: promo._id as any, userId });
  if (typeof promo.usageLimitTotal === 'number' && usage.totalUsed >= promo.usageLimitTotal) reasons.push('USAGE_LIMIT_TOTAL_REACHED');
  if (typeof promo.usageLimitPerUser === 'number' && usage.perUserUsed >= promo.usageLimitPerUser) reasons.push('USAGE_LIMIT_PER_USER_REACHED');

  if (typeof promo.minSubtotal === 'number' && subtotal < promo.minSubtotal) reasons.push('MIN_SUBTOTAL_NOT_MET');

  // Applicability (optional fields)
  const eligibleCategoryIds = asObjectIds((promo as any).eligibleCategoryIds);
  const eligibleBrandIds = asObjectIds((promo as any).eligibleBrandIds);
  const eligibleProductIds = asObjectIds((promo as any).eligibleProductIds);

  const requiresFilter = eligibleCategoryIds.length + eligibleBrandIds.length + eligibleProductIds.length > 0;
  let applicableItems = items;

  if (requiresFilter) {
    applicableItems = items.filter((it) => {
      const p = it.productId as any;
      const productId = p?._id?.toString?.() ?? String(p?._id ?? '');
      const brandId = p?.brandId?.toString?.() ?? String(p?.brandId ?? '');
      const categoryId = p?.categoryId?.toString?.() ?? String(p?.categoryId ?? '');

      const okProduct = eligibleProductIds.length === 0 || eligibleProductIds.some((x) => x.toString() === productId);
      const okBrand = eligibleBrandIds.length === 0 || eligibleBrandIds.some((x) => x.toString() === brandId);
      const okCategory = eligibleCategoryIds.length === 0 || eligibleCategoryIds.some((x) => x.toString() === categoryId);
      return okProduct && okBrand && okCategory;
    });
    if (applicableItems.length === 0) reasons.push('NOT_APPLICABLE');
  }

  if ((promo as any).excludeDiscountedItems) {
    applicableItems = applicableItems.filter((it) => !isDiscountedItem(it));
    if (applicableItems.length === 0) reasons.push('NOT_APPLICABLE');
  }

  const discountBase = applicableItems.reduce((sum, it) => sum + it.qty * it.price, 0);

  let discountAmount = 0;
  let maxDiscountApplied = false;
  if (discountBase > 0 && reasons.length === 0) {
    if (promo.type === 'PERCENT') {
      const pct = promo.value;
      discountAmount = floorInt((discountBase * pct) / 100);
    } else if (promo.type === 'FLAT') {
      discountAmount = Math.min(Math.trunc(promo.value), discountBase);
    }

    discountAmount = Math.max(0, Math.min(discountAmount, discountBase));
    if (typeof promo.maxDiscount === 'number' && discountAmount > promo.maxDiscount) {
      discountAmount = Math.trunc(promo.maxDiscount);
      maxDiscountApplied = true;
    }
  }

  const isValid = reasons.length === 0 && discountAmount >= 0;
  const newTotal = Math.max(subtotal - discountAmount, 0);

  return {
    isValid,
    reasons,
    subtotal,
    discountAmount,
    maxDiscountApplied: maxDiscountApplied || undefined,
    newTotal
  };
}
