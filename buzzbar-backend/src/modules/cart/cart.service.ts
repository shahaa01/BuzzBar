import mongoose from 'mongoose';
import { CartModel } from './cart.models.js';
import { VariantModel, ProductModel } from '../catalog/catalog.models.js';
import { InventoryStockModel, computeAvailability } from '../inventory/inventory.models.js';

function ensureObjectId(id: string) {
  if (!mongoose.isValidObjectId(id)) return null;
  return new mongoose.Types.ObjectId(id);
}

function asInt(n: unknown) {
  if (typeof n === 'number') return Math.trunc(n);
  const v = Number(n);
  return Number.isFinite(v) ? Math.trunc(v) : NaN;
}

export type CartExpandedItem = {
  variantId: string;
  qty: number;
  addedAt: string;
  product: {
    id: string;
    name: string;
    images: any[];
    brandId: string;
    categoryId: string;
    isActive: boolean;
  };
  variant: {
    id: string;
    sku: string;
    volumeMl: number;
    packSize: number;
    price: number;
    mrp?: number;
    isActive: boolean;
  };
  availability: number;
  lineTotal: number;
};

export type CartSummary = {
  items: { variantId: string; qty: number }[];
  expandedItems: CartExpandedItem[];
  subtotal: number;
  availabilityWarnings: { variantId: string; errorCode: string; available?: number }[];
  appliedPromoCode?: string;
};

export async function getOrCreateCart(userId: string) {
  const uid = ensureObjectId(userId);
  if (!uid) return null;
  await CartModel.updateOne(
    { userId: uid },
    { $setOnInsert: { userId: uid, items: [] } },
    { upsert: true }
  );
  return CartModel.findOne({ userId: uid }).exec();
}

export async function clearCart(userId: string) {
  const uid = ensureObjectId(userId);
  if (!uid) return null;
  await CartModel.updateOne({ userId: uid }, { $set: { items: [], appliedPromoCode: undefined } }, { upsert: true });
  return CartModel.findOne({ userId: uid }).exec();
}

export async function setCartItemQty(opts: { userId: string; variantId: string; qty: number }) {
  const uid = ensureObjectId(opts.userId);
  const vid = ensureObjectId(opts.variantId);
  if (!uid || !vid) return { ok: false as const, errorCode: 'INVALID_ID' as const };

  const qty = asInt(opts.qty);
  if (!Number.isFinite(qty) || qty < 0) return { ok: false as const, errorCode: 'INVALID_QTY' as const };

  const cart = await getOrCreateCart(opts.userId);
  if (!cart) return { ok: false as const, errorCode: 'NOT_FOUND' as const };

  const idx = cart.items.findIndex((i: any) => i.variantId.toString() === vid.toString());
  if (qty === 0) {
    if (idx >= 0) cart.items.splice(idx, 1);
    await cart.save();
    return { ok: true as const, cart };
  }

  const variant = await VariantModel.findById(vid).exec();
  if (!variant) return { ok: false as const, errorCode: 'VARIANT_NOT_FOUND' as const };
  if (!variant.isActive) return { ok: false as const, errorCode: 'VARIANT_INACTIVE' as const };

  const product = await ProductModel.findById(variant.productId).select({ isActive: 1 }).lean();
  if (product && (product as any).isActive === false) return { ok: false as const, errorCode: 'VARIANT_INACTIVE' as const };

  const stock = await InventoryStockModel.findOne({ variantId: vid }).lean();
  const available = computeAvailability(stock as any);
  if (available <= 0) return { ok: false as const, errorCode: 'OUT_OF_STOCK' as const, available };
  if (qty > available) return { ok: false as const, errorCode: 'INSUFFICIENT_STOCK' as const, available };

  if (idx >= 0) {
    (cart.items[idx] as any).qty = qty;
  } else {
    cart.items.push({ variantId: vid, qty, addedAt: new Date() } as any);
  }
  await cart.save();
  return { ok: true as const, cart };
}

export async function addOrIncrementCartItem(opts: { userId: string; variantId: string; qty: number }) {
  const uid = ensureObjectId(opts.userId);
  const vid = ensureObjectId(opts.variantId);
  if (!uid || !vid) return { ok: false as const, errorCode: 'INVALID_ID' as const };

  const qty = asInt(opts.qty);
  if (!Number.isFinite(qty) || qty < 1) return { ok: false as const, errorCode: 'INVALID_QTY' as const };

  const variant = await VariantModel.findById(vid).exec();
  if (!variant) return { ok: false as const, errorCode: 'VARIANT_NOT_FOUND' as const };
  if (!variant.isActive) return { ok: false as const, errorCode: 'VARIANT_INACTIVE' as const };
  const product = await ProductModel.findById(variant.productId).select({ isActive: 1 }).lean();
  if (product && (product as any).isActive === false) return { ok: false as const, errorCode: 'VARIANT_INACTIVE' as const };

  const stock = await InventoryStockModel.findOne({ variantId: vid }).lean();
  const available = computeAvailability(stock as any);
  if (available <= 0) return { ok: false as const, errorCode: 'OUT_OF_STOCK' as const, available };

  const cart = await getOrCreateCart(opts.userId);
  if (!cart) return { ok: false as const, errorCode: 'NOT_FOUND' as const };

  const idx = cart.items.findIndex((i: any) => i.variantId.toString() === vid.toString());
  const currentQty = idx >= 0 ? asInt((cart.items[idx] as any).qty) : 0;
  const nextQty = currentQty + qty;
  if (nextQty > available) return { ok: false as const, errorCode: 'INSUFFICIENT_STOCK' as const, available };

  if (idx >= 0) {
    (cart.items[idx] as any).qty = nextQty;
  } else {
    cart.items.push({ variantId: vid, qty: nextQty, addedAt: new Date() } as any);
  }
  await cart.save();
  return { ok: true as const, cart };
}

export async function removeCartItem(opts: { userId: string; variantId: string }) {
  const uid = ensureObjectId(opts.userId);
  const vid = ensureObjectId(opts.variantId);
  if (!uid || !vid) return null;

  const cart = await getOrCreateCart(opts.userId);
  if (!cart) return null;
  const idx = cart.items.findIndex((i: any) => i.variantId.toString() === vid.toString());
  if (idx >= 0) cart.items.splice(idx, 1);
  await cart.save();
  return cart;
}

export async function computeCartSummary(userId: string): Promise<CartSummary | null> {
  const uid = ensureObjectId(userId);
  if (!uid) return null;

  const cart = await getOrCreateCart(userId);
  if (!cart) return null;

  const ids = cart.items.map((i: any) => i.variantId.toString());
  const uniqueIds = Array.from(new Set(ids)).filter((s) => mongoose.isValidObjectId(s)) as string[];
  const variantObjectIds = uniqueIds.map((s) => new mongoose.Types.ObjectId(s));

  const variants = await VariantModel.find({ _id: { $in: variantObjectIds } })
    .populate('productId', { name: 1, images: 1, brandId: 1, categoryId: 1, isActive: 1 })
    .lean();
  const variantById = new Map<string, any>(variants.map((v: any) => [v._id.toString(), v]));

  const stocks = await InventoryStockModel.find({ variantId: { $in: variantObjectIds } }).lean();
  const availabilityByVariantId = new Map<string, number>(
    stocks.map((s: any) => [s.variantId.toString(), computeAvailability(s)])
  );

  const expandedItems: CartExpandedItem[] = [];
  const warnings: { variantId: string; errorCode: string; available?: number }[] = [];
  let subtotal = 0;

  for (const item of cart.items as any[]) {
    const variantId = item.variantId.toString();
    const qty = asInt(item.qty);
    const v = variantById.get(variantId);
    if (!v) {
      warnings.push({ variantId, errorCode: 'VARIANT_NOT_FOUND' });
      continue;
    }
    if (!v.isActive || (v.productId && (v.productId as any).isActive === false)) {
      warnings.push({ variantId, errorCode: 'VARIANT_INACTIVE' });
    }

    const available = availabilityByVariantId.get(variantId) ?? 0;
    if (available <= 0) warnings.push({ variantId, errorCode: 'OUT_OF_STOCK', available });
    else if (qty > available) warnings.push({ variantId, errorCode: 'INSUFFICIENT_STOCK', available });

    const price = asInt(v.price);
    const lineTotal = qty * price;
    subtotal += lineTotal;

    expandedItems.push({
      variantId,
      qty,
      addedAt: (item.addedAt as Date)?.toISOString?.() ?? new Date(item.addedAt).toISOString(),
      product: {
        id: v.productId?._id?.toString?.() ?? String(v.productId),
        name: v.productId?.name ?? '',
        images: v.productId?.images ?? [],
        brandId: v.productId?.brandId?.toString?.() ?? String(v.productId?.brandId ?? ''),
        categoryId: v.productId?.categoryId?.toString?.() ?? String(v.productId?.categoryId ?? ''),
        isActive: v.productId?.isActive ?? true
      },
      variant: {
        id: v._id.toString(),
        sku: v.sku,
        volumeMl: v.volumeMl,
        packSize: v.packSize,
        price,
        mrp: v.mrp ?? undefined,
        isActive: v.isActive
      },
      availability: available,
      lineTotal
    });
  }

  return {
    items: cart.items.map((i: any) => ({ variantId: i.variantId.toString(), qty: asInt(i.qty) })),
    expandedItems,
    subtotal,
    availabilityWarnings: warnings,
    appliedPromoCode: cart.appliedPromoCode ?? undefined
  };
}
