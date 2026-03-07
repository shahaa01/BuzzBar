import mongoose from 'mongoose';
import { SETTINGS_SINGLETON_ID, SettingsModel } from '../admin/admin.models.js';
import { CartModel } from '../cart/cart.models.js';
import { computeCartSummary } from '../cart/cart.service.js';
import { PromotionModel } from '../promotions/promotions.models.js';
import { validatePromotion } from '../promotions/promotions.service.js';
import { UserModel } from '../user/user.models.js';
import { InventoryStockModel, computeAvailability } from '../inventory/inventory.models.js';
import { OrderCounterModel, OrderModel, type OrderStatus, type PaymentMethod, type PaymentStatus, type KycGateStatus } from './orders.models.js';
import { reserveStockLines, releaseReservedStockLines, commitDeliveredStockLines } from './orders.stock.js';
import { isWithinNightHours, getYearInTimeZone } from './orders.time.js';

function ensureObjectId(id: string) {
  if (!mongoose.isValidObjectId(id)) return null;
  return new mongoose.Types.ObjectId(id);
}

function pad6(n: number) {
  return String(n).padStart(6, '0');
}

async function ensureSettings() {
  await SettingsModel.updateOne(
    { _id: SETTINGS_SINGLETON_ID },
    { $setOnInsert: { _id: SETTINGS_SINGLETON_ID } },
    { upsert: true }
  );
  return SettingsModel.findById(SETTINGS_SINGLETON_ID).lean();
}

async function nextOrderNumber(opts: { now: Date; timeZone: string }) {
  const year = getYearInTimeZone(opts.now, opts.timeZone);
  const counter = await OrderCounterModel.findByIdAndUpdate(
    String(year),
    { $inc: { seq: 1 } },
    { upsert: true, new: true, lean: true }
  );
  const seq = Number((counter as any)?.seq ?? 1);
  return `BB-${year}-${pad6(seq)}`;
}

function normalizeArea(area: string) {
  return area.trim().toLowerCase();
}

function floorInt(n: number) {
  return Math.floor(n);
}

export type CreateOrderAddress = {
  label?: string;
  fullAddress: string;
  area: string;
  landmark?: string;
  lat?: number;
  lng?: number;
  contactName?: string;
  contactPhone?: string;
};

export async function createOrderFromCart(opts: {
  userId: string;
  paymentMethod: PaymentMethod;
  promoCode?: string;
  address: CreateOrderAddress;
}) {
  const uid = ensureObjectId(opts.userId);
  if (!uid) return { ok: false as const, errorCode: 'NOT_FOUND' as const };

  const user = await UserModel.findById(uid).exec();
  if (!user) return { ok: false as const, errorCode: 'NOT_FOUND' as const };
  if (user.kycStatus === 'rejected') return { ok: false as const, errorCode: 'KYC_REJECTED' as const };

  const settings = await ensureSettings();
  const serviceAreas = ((settings as any)?.serviceAreas ?? []) as string[];
  const allowedAreas = new Set(serviceAreas.map((s) => normalizeArea(String(s))));
  const area = normalizeArea(opts.address.area);
  if (!allowedAreas.has(area)) return { ok: false as const, errorCode: 'SERVICE_AREA_NOT_SUPPORTED' as const };

  const timeZone = String((settings as any)?.nightHours?.timezone ?? 'Asia/Kathmandu');
  const now = new Date();
  if (opts.paymentMethod === 'COD') {
    const nh = (settings as any)?.nightHours;
    if (nh?.start && nh?.end) {
      if (isWithinNightHours({ now, start: String(nh.start), end: String(nh.end), timeZone })) {
        return { ok: false as const, errorCode: 'NIGHT_HOURS_COD_REJECTED' as const };
      }
    }
  }

  const cart = await CartModel.findOne({ userId: uid }).exec();
  const cartItems = (cart?.items ?? []) as any[];
  if (cartItems.length === 0) return { ok: false as const, errorCode: 'CART_EMPTY' as const };

  const summary = await computeCartSummary(opts.userId);
  const expanded = summary?.expandedItems ?? [];
  if (expanded.length === 0) return { ok: false as const, errorCode: 'CART_EMPTY' as const };

  // strict stock/variant validation at order-time
  const variantIds = expanded.map((it) => new mongoose.Types.ObjectId(it.variantId));
  const stocks = await InventoryStockModel.find({ variantId: { $in: variantIds } }).lean();
  const stockByVariantId = new Map<string, any>(stocks.map((s: any) => [s.variantId.toString(), s]));

  for (const it of expanded) {
    if (!it.variant.isActive || !it.product.isActive) return { ok: false as const, errorCode: 'VARIANT_INACTIVE' as const };
    const stock = stockByVariantId.get(it.variantId);
    const available = computeAvailability(stock);
    if (available <= 0) return { ok: false as const, errorCode: 'OUT_OF_STOCK' as const, details: { variantId: it.variantId, available } };
    if (it.qty > available) return { ok: false as const, errorCode: 'INSUFFICIENT_STOCK' as const, details: { variantId: it.variantId, available } };
  }

  const promoCode = (opts.promoCode ?? cart?.appliedPromoCode ?? '').trim().toUpperCase();
  let promoSnapshot: any = undefined;
  let discount = 0;

  if (promoCode) {
    const validation = await validatePromotion({ code: promoCode, userId: opts.userId, mode: 'items', items: expanded.map((i) => ({ variantId: i.variantId, qty: i.qty })) });
    if (!validation.isValid) {
      return { ok: false as const, errorCode: 'PROMO_INVALID' as const, details: { reasons: validation.reasons } };
    }
    discount = floorInt(validation.discountAmount);

    const promo = (await PromotionModel.findOne({ code: promoCode }).lean().exec()) as any | null;
    if (promo) {
      promoSnapshot = {
        code: promoCode,
        type: promo.type,
        value: promo.value,
        discountAmount: discount,
        maxDiscountApplied: validation.maxDiscountApplied ?? undefined
      };
    }
  }

  const orderItems = expanded.map((it) => {
    const unitPrice = floorInt(it.variant.price);
    const qty = floorInt(it.qty);
    return {
      productId: new mongoose.Types.ObjectId(it.product.id),
      variantId: new mongoose.Types.ObjectId(it.variantId),
      productName: it.product.name,
      brandName: undefined,
      volumeMl: it.variant.volumeMl,
      packSize: it.variant.packSize,
      imageUrl: it.product.images?.[0]?.url,
      unitPrice,
      qty,
      lineTotal: unitPrice * qty
    };
  });

  const subtotal = orderItems.reduce((sum, it) => sum + it.lineTotal, 0);
  const deliveryFee = floorInt(Number((settings as any)?.deliveryFeeFlat ?? 0));
  const total = Math.max(subtotal - discount + deliveryFee, 0);

  const kycGateStatus: KycGateStatus = user.kycStatus === 'verified' ? 'PASS' : user.kycStatus === 'pending' ? 'REVIEW_REQUIRED' : 'FAIL';
  const status: OrderStatus = kycGateStatus === 'REVIEW_REQUIRED' ? 'KYC_PENDING_REVIEW' : 'CREATED';
  const paymentStatus: PaymentStatus = opts.paymentMethod === 'COD' ? 'UNPAID' : 'PENDING';

  const reserveRes = await reserveStockLines(orderItems.map((it) => ({ variantId: it.variantId, qty: it.qty })));
  if (!reserveRes.ok) return { ok: false as const, errorCode: 'INSUFFICIENT_STOCK' as const };

  try {
    const orderNumber = await nextOrderNumber({ now, timeZone });
    const created = await OrderModel.create({
      orderNumber,
      userId: uid,
      status,
      paymentMethod: opts.paymentMethod,
      paymentStatus,
      kycGateStatus,
      kycStatusSnapshot: user.kycStatus,
      addressSnapshot: opts.address,
      items: orderItems,
      promoSnapshot,
      subtotal,
      discount,
      deliveryFee,
      total
    });

    // clear cart after successful creation
    await CartModel.updateOne({ userId: uid }, { $set: { items: [], appliedPromoCode: undefined } }, { upsert: true });

    return { ok: true as const, orderId: created._id.toString(), orderNumber };
  } catch (e) {
    await releaseReservedStockLines(orderItems.map((it) => ({ variantId: it.variantId, qty: it.qty })));
    throw e;
  }
}

export async function listCustomerOrders(opts: { userId: string; page: number; limit: number }) {
  const uid = ensureObjectId(opts.userId);
  if (!uid) return { items: [], total: 0 };
  const skip = (opts.page - 1) * opts.limit;
  const [items, total] = await Promise.all([
    OrderModel.find({ userId: uid })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(opts.limit)
      .select({ orderNumber: 1, status: 1, paymentMethod: 1, paymentStatus: 1, total: 1, createdAt: 1 })
      .lean(),
    OrderModel.countDocuments({ userId: uid })
  ]);
  return { items, total };
}

export async function getCustomerOrderDetail(opts: { userId: string; orderId: string }) {
  const uid = ensureObjectId(opts.userId);
  const oid = ensureObjectId(opts.orderId);
  if (!uid || !oid) return null;
  return OrderModel.findOne({ _id: oid, userId: uid }).lean();
}

export async function cancelOrderAndReleaseStock(opts: { orderId: string; actorAdminId?: string; reason: string }) {
  const oid = ensureObjectId(opts.orderId);
  if (!oid) return { ok: false as const, errorCode: 'NOT_FOUND' as const };
  const order = await OrderModel.findById(oid).exec();
  if (!order) return { ok: false as const, errorCode: 'NOT_FOUND' as const };
  if (order.status === 'CANCELLED' || order.status === 'DELIVERED') {
    return { ok: false as const, errorCode: 'ORDER_TERMINAL' as const };
  }

  const lines = (order.items as any[]).map((it) => ({ variantId: it.variantId as mongoose.Types.ObjectId, qty: Number(it.qty) }));
  await releaseReservedStockLines(lines);

  order.status = 'CANCELLED';
  order.cancelReason = opts.reason;
  order.cancelledAt = new Date();
  await order.save();
  return { ok: true as const };
}

export async function cancelOrdersForKycRejected(opts: { userId: string; reason: string }) {
  const uid = ensureObjectId(opts.userId);
  if (!uid) return;
  const orders = await OrderModel.find({ userId: uid, status: 'KYC_PENDING_REVIEW' }).exec();
  for (const o of orders) {
    await cancelOrderAndReleaseStock({ orderId: o._id.toString(), reason: opts.reason });
  }
}

export async function adminListOrders(opts: { status?: string; paymentStatus?: string; page: number; limit: number }) {
  const filter: any = {};
  if (opts.status) filter.status = opts.status;
  if (opts.paymentStatus) filter.paymentStatus = opts.paymentStatus;
  const skip = (opts.page - 1) * opts.limit;
  const [items, total] = await Promise.all([
    OrderModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(opts.limit)
      .lean(),
    OrderModel.countDocuments(filter)
  ]);
  return { items, total };
}

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  CREATED: ['CONFIRMED', 'CANCELLED'],
  KYC_PENDING_REVIEW: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PACKING', 'CANCELLED'],
  PACKING: ['READY_FOR_DISPATCH', 'CANCELLED'],
  READY_FOR_DISPATCH: ['OUT_FOR_DELIVERY', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: []
};

export async function adminUpdateOrderStatus(opts: {
  orderId: string;
  nextStatus: OrderStatus;
  adminId: string;
}) {
  const oid = ensureObjectId(opts.orderId);
  if (!oid) return { ok: false as const, errorCode: 'NOT_FOUND' as const };

  const order = await OrderModel.findById(oid).exec();
  if (!order) return { ok: false as const, errorCode: 'NOT_FOUND' as const };

  const from = order.status as OrderStatus;
  const allowed = TRANSITIONS[from] ?? [];
  if (!allowed.includes(opts.nextStatus)) {
    return { ok: false as const, errorCode: 'INVALID_STATUS_TRANSITION' as const, details: { from, to: opts.nextStatus } };
  }

  // KYC gate: cannot proceed out of KYC_PENDING_REVIEW unless user is verified
  if (from === 'KYC_PENDING_REVIEW' && opts.nextStatus !== 'CANCELLED') {
    const user = await UserModel.findById(order.userId).select({ kycStatus: 1 }).lean();
    if (!user || (user as any).kycStatus !== 'verified') {
      return { ok: false as const, errorCode: 'KYC_REVIEW_REQUIRED' as const };
    }
    order.kycGateStatus = 'PASS';
  }

  // Wallet progression rule: require payment PAID before CONFIRMED -> PACKING
  if (from === 'CONFIRMED' && opts.nextStatus === 'PACKING') {
    if (order.paymentMethod === 'WALLET' && order.paymentStatus !== 'PAID') {
      return { ok: false as const, errorCode: 'PAYMENT_NOT_PAID' as const };
    }
  }

  if (opts.nextStatus === 'CANCELLED') {
    const lines = (order.items as any[]).map((it) => ({ variantId: it.variantId as mongoose.Types.ObjectId, qty: Number(it.qty) }));
    await releaseReservedStockLines(lines);
    order.cancelledAt = new Date();
    order.cancelReason = 'admin_cancelled';
  }

  if (opts.nextStatus === 'DELIVERED') {
    const lines = (order.items as any[]).map((it) => ({ variantId: it.variantId as mongoose.Types.ObjectId, qty: Number(it.qty) }));
    await commitDeliveredStockLines(lines);
    order.deliveredAt = new Date();
  }

  order.status = opts.nextStatus;
  await order.save();

  return { ok: true as const, status: order.status };
}

export async function adminAssignOrder(opts: { orderId: string; assignedToAdminId: string }) {
  const oid = ensureObjectId(opts.orderId);
  const aid = ensureObjectId(opts.assignedToAdminId);
  if (!oid || !aid) return { ok: false as const, errorCode: 'INVALID_ID' as const };
  const order = await OrderModel.findById(oid).exec();
  if (!order) return { ok: false as const, errorCode: 'NOT_FOUND' as const };
  order.assignedToAdminId = aid as any;
  order.assignedAt = new Date();
  await order.save();
  return { ok: true as const };
}
