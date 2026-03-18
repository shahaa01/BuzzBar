import mongoose from 'mongoose';
import { AdminUserModel } from '../admin/admin.models.js';
import { SETTINGS_SINGLETON_ID, SettingsModel } from '../admin/admin.models.js';
import { CartModel } from '../cart/cart.models.js';
import { computeCartSummary } from '../cart/cart.service.js';
import { BrandModel } from '../catalog/catalog.models.js';
import { PromotionModel } from '../promotions/promotions.models.js';
import { validatePromotion } from '../promotions/promotions.service.js';
import { PaymentTransactionModel } from '../payments/payments.models.js';
import { UserModel } from '../user/user.models.js';
import { InventoryStockModel, computeAvailability } from '../inventory/inventory.models.js';
import { OrderCounterModel, OrderModel, OrderOperationAuditModel, type OrderStatus, type PaymentMethod, type PaymentStatus, type KycGateStatus, type OrderProgressBlockedReason } from './orders.models.js';
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

  const brandIds = Array.from(new Set(expanded.map((it) => it.product.brandId).filter(Boolean)))
    .filter((id) => mongoose.isValidObjectId(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  const brands = await BrandModel.find({ _id: { $in: brandIds } }).select({ name: 1 }).lean().exec();
  const brandNameById = new Map<string, string>(brands.map((brand: any) => [brand._id.toString(), brand.name]));

  const orderItems = expanded.map((it) => {
    const unitPrice = floorInt(it.variant.price);
    const qty = floorInt(it.qty);
    return {
      productId: new mongoose.Types.ObjectId(it.product.id),
      variantId: new mongoose.Types.ObjectId(it.variantId),
      productName: it.product.name,
      brandName: brandNameById.get(it.product.brandId),
      sku: it.variant.sku,
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

  const deliveryAgeCheckRequired = user.kycStatus !== 'verified';
  const progressBlockedReason: OrderProgressBlockedReason | undefined = user.kycStatus === 'rejected' ? 'KYC_REQUIRED' : undefined;
  const kycGateStatus: KycGateStatus = user.kycStatus === 'verified' ? 'PASS' : user.kycStatus === 'rejected' ? 'FAIL' : 'REVIEW_REQUIRED';
  const status: OrderStatus = 'CREATED';
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
      deliveryAgeCheckRequired,
      progressBlockedReason,
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
      .select({ orderNumber: 1, status: 1, paymentMethod: 1, paymentStatus: 1, kycStatusSnapshot: 1, deliveryAgeCheckRequired: 1, progressBlockedReason: 1, total: 1, createdAt: 1 })
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

export async function markOpenOrdersForRejectedKyc(opts: { userId: string; reason: string }) {
  const uid = ensureObjectId(opts.userId);
  if (!uid) return;
  const orders = await OrderModel.find({ userId: uid, status: { $nin: ['CANCELLED', 'DELIVERED'] } }).exec();
  for (const order of orders) {
    if (order.status === 'KYC_PENDING_REVIEW') {
      order.status = 'CREATED';
    }
    order.deliveryAgeCheckRequired = true;
    order.progressBlockedReason = 'KYC_REQUIRED';
    order.kycGateStatus = 'FAIL';
    order.ageVerificationNote = opts.reason;
    await order.save();
  }
}

export async function clearOpenOrderAgeVerificationFlags(opts: {
  userId: string;
  actorAdminId?: string;
  note?: string;
}) {
  const uid = ensureObjectId(opts.userId);
  const actorId = opts.actorAdminId ? ensureObjectId(opts.actorAdminId) : null;
  if (!uid) return;
  const orders = await OrderModel.find({ userId: uid, status: { $nin: ['CANCELLED', 'DELIVERED'] } }).exec();
  for (const order of orders) {
    if (order.status === 'KYC_PENDING_REVIEW') {
      order.status = 'CREATED';
    }
    order.deliveryAgeCheckRequired = false;
    order.progressBlockedReason = undefined;
    order.kycGateStatus = 'PASS';
    order.ageVerificationUpdatedAt = new Date();
    order.ageVerificationUpdatedByAdminId = actorId ?? undefined;
    if (opts.note?.trim()) {
      order.ageVerificationNote = opts.note.trim();
    }
    await order.save();
  }
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function adminListOrders(opts: {
  status?: string;
  paymentMethod?: string;
  paymentStatus?: string;
  kycStatusSnapshot?: string;
  assigned?: 'assigned' | 'unassigned';
  serviceArea?: string;
  from?: string;
  to?: string;
  q?: string;
  sort?: 'createdAt_desc' | 'createdAt_asc' | 'total_desc' | 'total_asc';
  page: number;
  limit: number;
}) {
  const filter: any = {};
  if (opts.status) filter.status = opts.status;
  if (opts.paymentMethod) filter.paymentMethod = opts.paymentMethod;
  if (opts.paymentStatus) filter.paymentStatus = opts.paymentStatus;
  if (opts.kycStatusSnapshot) filter.kycStatusSnapshot = opts.kycStatusSnapshot;
  if (opts.assigned === 'assigned') filter.assignedToAdminId = { $exists: true, $ne: null };
  if (opts.assigned === 'unassigned') filter.$or = [{ assignedToAdminId: { $exists: false } }, { assignedToAdminId: null }];
  if (opts.serviceArea) filter['addressSnapshot.area'] = new RegExp(`^${escapeRe(opts.serviceArea.trim())}$`, 'i');

  const fromDate = opts.from ? new Date(opts.from) : null;
  const toDate = opts.to ? new Date(opts.to) : null;
  if (fromDate || toDate) {
    filter.createdAt = {};
    if (fromDate) filter.createdAt.$gte = fromDate;
    if (toDate) filter.createdAt.$lt = toDate;
  }

  const q = opts.q?.trim();
  if (q) {
    const re = new RegExp(escapeRe(q), 'i');
    const matchingUsers = await UserModel.find({
      $or: [{ email: re }, { name: re }, { phone: re }]
    })
      .select({ _id: 1 })
      .limit(100)
      .lean()
      .exec();
    const userIds = matchingUsers.map((u: any) => u._id);
    filter.$and = [
      ...(filter.$and ?? []),
      {
        $or: [
          { orderNumber: { $regex: re } },
          ...(userIds.length > 0 ? [{ userId: { $in: userIds } }] : [])
        ]
      }
    ];
  }

  const skip = (opts.page - 1) * opts.limit;
  const sort: Record<string, 1 | -1> =
    opts.sort === 'createdAt_asc'
      ? { createdAt: 1, _id: 1 }
      : opts.sort === 'total_desc'
        ? { total: -1, createdAt: -1, _id: -1 }
        : opts.sort === 'total_asc'
          ? { total: 1, createdAt: -1, _id: -1 }
          : { createdAt: -1, _id: -1 };
  const [items, total] = await Promise.all([
    OrderModel.aggregate([
      { $match: filter },
      { $sort: sort },
      { $skip: skip },
      { $limit: opts.limit },
      {
        $lookup: {
          from: UserModel.collection.name,
          localField: 'userId',
          foreignField: '_id',
          as: 'user'
        }
      },
      { $addFields: { user: { $ifNull: [{ $first: '$user' }, null] } } },
      {
        $lookup: {
          from: AdminUserModel.collection.name,
          localField: 'assignedToAdminId',
          foreignField: '_id',
          as: 'assignedAdmin'
        }
      },
      { $addFields: { assignedAdmin: { $ifNull: [{ $first: '$assignedAdmin' }, null] } } },
      {
        $lookup: {
          from: PaymentTransactionModel.collection.name,
          let: { orderId: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$orderId', '$$orderId'] } } },
            { $sort: { createdAt: -1, _id: -1 } },
            { $limit: 1 }
          ],
          as: 'latestPayment'
        }
      },
      { $addFields: { latestPayment: { $ifNull: [{ $first: '$latestPayment' }, null] } } },
      {
        $project: {
          _id: { $toString: '$_id' },
          orderNumber: 1,
          status: 1,
          paymentMethod: 1,
          paymentStatus: 1,
          kycStatusSnapshot: 1,
          deliveryAgeCheckRequired: 1,
          progressBlockedReason: 1,
          total: 1,
          createdAt: 1,
          assignedAt: 1,
          'addressSnapshot.area': 1,
          user: {
            id: { $cond: [{ $ifNull: ['$user._id', false] }, { $toString: '$user._id' }, null] },
            email: '$user.email',
            phone: '$user.phone',
            name: '$user.name',
            kycStatus: '$user.kycStatus'
          },
          assignedTo: {
            id: { $cond: [{ $ifNull: ['$assignedAdmin._id', false] }, { $toString: '$assignedAdmin._id' }, null] },
            email: '$assignedAdmin.email',
            role: '$assignedAdmin.role'
          },
          paymentTransaction: {
            id: { $cond: [{ $ifNull: ['$latestPayment._id', false] }, { $toString: '$latestPayment._id' }, null] },
            provider: '$latestPayment.provider',
            status: '$latestPayment.status',
            providerReference: '$latestPayment.providerReference',
            isMock: { $eq: ['$latestPayment.provider', 'MOCK'] }
          }
        }
      }
    ]).exec(),
    OrderModel.countDocuments(filter)
  ]);
  return {
    items: items.map((item: any) => ({
      ...item,
      quickActions: buildOrderActionDescriptors({
        order: {
          status: item.status as OrderStatus,
          paymentMethod: item.paymentMethod,
          paymentStatus: item.paymentStatus,
          progressBlockedReason: item.progressBlockedReason
        },
        userKycStatus: item.user?.kycStatus
      })
    })),
    total
  };
}

export async function listOrderAssignees() {
  const items = await AdminUserModel.find({ isActive: true })
    .sort({ role: 1, email: 1 })
    .select({ email: 1, role: 1 })
    .lean()
    .exec();

  return items.map((admin: any) => ({
    id: admin._id.toString(),
    email: admin.email,
    role: admin.role
  }));
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

type OrderActionId =
  | 'CONFIRM_ORDER'
  | 'MOVE_TO_PACKING'
  | 'MARK_READY_FOR_DISPATCH'
  | 'MARK_OUT_FOR_DELIVERY'
  | 'MARK_DELIVERED'
  | 'CANCEL_ORDER';

function actionIdForStatus(to: OrderStatus): OrderActionId {
  if (to === 'CONFIRMED') return 'CONFIRM_ORDER';
  if (to === 'PACKING') return 'MOVE_TO_PACKING';
  if (to === 'READY_FOR_DISPATCH') return 'MARK_READY_FOR_DISPATCH';
  if (to === 'OUT_FOR_DELIVERY') return 'MARK_OUT_FOR_DELIVERY';
  if (to === 'DELIVERED') return 'MARK_DELIVERED';
  return 'CANCEL_ORDER';
}

async function recordOrderOperationAudit(opts: {
  orderId: mongoose.Types.ObjectId;
  actorAdminId: string;
  type: 'STATUS_TRANSITION' | 'ASSIGNMENT';
  actionId: string;
  fromStatus?: OrderStatus;
  toStatus?: OrderStatus;
  previousAssignedToAdminId?: mongoose.Types.ObjectId | null;
  assignedToAdminId?: mongoose.Types.ObjectId | null;
  reason?: string;
}) {
  const actorId = ensureObjectId(opts.actorAdminId);
  if (!actorId) return;

  await OrderOperationAuditModel.create({
    orderId: opts.orderId,
    actorAdminId: actorId,
    type: opts.type,
    actionId: opts.actionId,
    fromStatus: opts.fromStatus,
    toStatus: opts.toStatus,
    previousAssignedToAdminId: opts.previousAssignedToAdminId ?? undefined,
    assignedToAdminId: opts.assignedToAdminId ?? undefined,
    reason: opts.reason
  });
}

export function computeAdminOrderActions(opts: {
  order: { status: OrderStatus; paymentMethod: any; paymentStatus: any; progressBlockedReason?: string | null };
  userKycStatus?: string;
}) {
  const from = opts.order.status;
  const candidates = TRANSITIONS[from] ?? [];
  return candidates.map((to) => {
    if (opts.order.progressBlockedReason === 'KYC_REQUIRED' && to !== 'CANCELLED') {
      return { to, allowed: false as const, reasonCode: 'KYC_REQUIRED' as const };
    }
    if (from === 'KYC_PENDING_REVIEW' && to !== 'CANCELLED') {
      if (opts.userKycStatus !== 'verified') return { to, allowed: false as const, reasonCode: 'KYC_REVIEW_REQUIRED' as const };
    }
    if (from === 'CONFIRMED' && to === 'PACKING') {
      if (opts.order.paymentMethod === 'WALLET' && opts.order.paymentStatus !== 'PAID') {
        return { to, allowed: false as const, reasonCode: 'PAYMENT_NOT_PAID' as const };
      }
    }
    return { to, allowed: true as const };
  });
}

function describeOrderAction(to: OrderStatus) {
  if (to === 'CONFIRMED') {
    return { id: actionIdForStatus(to), label: 'Confirm order', tone: 'default' as const };
  }
  if (to === 'PACKING') {
    return { id: actionIdForStatus(to), label: 'Move to packing', tone: 'default' as const };
  }
  if (to === 'READY_FOR_DISPATCH') {
    return { id: actionIdForStatus(to), label: 'Mark ready for dispatch', tone: 'default' as const };
  }
  if (to === 'OUT_FOR_DELIVERY') {
    return { id: actionIdForStatus(to), label: 'Mark out for delivery', tone: 'default' as const };
  }
  if (to === 'DELIVERED') {
    return { id: actionIdForStatus(to), label: 'Mark delivered', tone: 'default' as const };
  }
  return { id: actionIdForStatus(to), label: 'Cancel order', tone: 'destructive' as const };
}

function buildOrderActionDescriptors(opts: {
  order: { status: OrderStatus; paymentMethod: any; paymentStatus: any; progressBlockedReason?: string | null };
  userKycStatus?: string;
}) {
  return computeAdminOrderActions(opts).map((action) => {
    const descriptor = describeOrderAction(action.to);
    return {
      ...descriptor,
      to: action.to,
      toStatus: action.to,
      allowed: action.allowed,
      reasonCode: 'reasonCode' in action ? action.reasonCode : undefined
    };
  });
}

export async function adminUpdateOrderStatus(opts: {
  orderId: string;
  nextStatus: OrderStatus;
  adminId: string;
}) {
  return adminTransitionOrder({ orderId: opts.orderId, actionId: actionIdForStatus(opts.nextStatus), adminId: opts.adminId });
}

export async function adminTransitionOrder(opts: { orderId: string; actionId: string; adminId: string }) {
  const oid = ensureObjectId(opts.orderId);
  if (!oid) return { ok: false as const, errorCode: 'NOT_FOUND' as const };

  const order = await OrderModel.findById(oid).exec();
  if (!order) return { ok: false as const, errorCode: 'NOT_FOUND' as const };
  if (order.status === 'DELIVERED') {
    return { ok: false as const, errorCode: 'ORDER_ALREADY_DELIVERED' as const, details: { status: order.status } };
  }

  let userKycStatus: string | undefined = undefined;
  if (order.status === 'KYC_PENDING_REVIEW') {
    const user = await UserModel.findById(order.userId).select({ kycStatus: 1 }).lean().exec();
    userKycStatus = (user as any)?.kycStatus;
  }

  const actions = buildOrderActionDescriptors({
    order: {
      status: order.status as OrderStatus,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      progressBlockedReason: order.progressBlockedReason
    },
    userKycStatus
  });

  const action = actions.find((candidate) => candidate.id === opts.actionId);
  if (!action) {
    return {
      ok: false as const,
      errorCode: 'ORDER_TRANSITION_INVALID' as const,
      details: { status: order.status, actionId: opts.actionId }
    };
  }
  if (!action.allowed) {
    return { ok: false as const, errorCode: action.reasonCode };
  }

  const nextStatus = action.toStatus;
  const fromStatus = order.status as OrderStatus;
  if (fromStatus === 'KYC_PENDING_REVIEW' && nextStatus !== 'CANCELLED') {
    order.kycGateStatus = 'PASS';
  }

  if (nextStatus === 'CANCELLED') {
    const lines = (order.items as any[]).map((it) => ({ variantId: it.variantId as mongoose.Types.ObjectId, qty: Number(it.qty) }));
    await releaseReservedStockLines(lines);
    order.cancelledAt = new Date();
    order.cancelReason = 'admin_cancelled';
  }

  if (nextStatus === 'DELIVERED') {
    const lines = (order.items as any[]).map((it) => ({ variantId: it.variantId as mongoose.Types.ObjectId, qty: Number(it.qty) }));
    await commitDeliveredStockLines(lines);
    order.deliveredAt = new Date();
  }

  order.status = nextStatus;
  await order.save();
  await recordOrderOperationAudit({
    orderId: order._id,
    actorAdminId: opts.adminId,
    type: 'STATUS_TRANSITION',
    actionId: action.id,
    fromStatus,
    toStatus: nextStatus
  });

  return { ok: true as const, status: order.status, actionId: action.id };
}

export async function adminMarkAgeVerificationFailed(opts: {
  orderId: string;
  adminId: string;
  note?: string;
}) {
  const oid = ensureObjectId(opts.orderId);
  const actorId = ensureObjectId(opts.adminId);
  if (!oid || !actorId) return { ok: false as const, errorCode: 'NOT_FOUND' as const };

  const order = await OrderModel.findById(oid).exec();
  if (!order) return { ok: false as const, errorCode: 'NOT_FOUND' as const };
  if (order.status !== 'OUT_FOR_DELIVERY') {
    return { ok: false as const, errorCode: 'AGE_VERIFICATION_ACTION_NOT_ALLOWED' as const, details: { status: order.status } };
  }

  const user = await UserModel.findById(order.userId).exec();
  if (!user) return { ok: false as const, errorCode: 'NOT_FOUND' as const };

  const cancelResult = await cancelOrderAndReleaseStock({
    orderId: order._id.toString(),
    actorAdminId: opts.adminId,
    reason: 'AGE_VERIFICATION_FAILED'
  });
  if (!cancelResult.ok) return cancelResult;

  const cancelled = await OrderModel.findById(order._id).exec();
  if (!cancelled) return { ok: false as const, errorCode: 'NOT_FOUND' as const };
  cancelled.progressBlockedReason = 'AGE_VERIFICATION_FAILED';
  cancelled.deliveryAgeCheckRequired = true;
  cancelled.ageVerificationUpdatedAt = new Date();
  cancelled.ageVerificationUpdatedByAdminId = actorId as any;
  cancelled.ageVerificationNote = opts.note?.trim() || 'AGE_VERIFICATION_FAILED';
  await cancelled.save();

  const before = {
    kycStatus: user.kycStatus,
    kycVerifiedAt: user.kycVerifiedAt,
    kycRejectedAt: user.kycRejectedAt,
    kycRejectionReason: user.kycRejectionReason
  };
  if (user.kycStatus !== 'verified') {
    user.kycStatus = 'rejected';
    user.kycVerifiedAt = undefined;
    user.kycRejectedAt = new Date();
    user.kycRejectionReason = 'AGE_VERIFICATION_FAILED';
    await user.save();
  }

  await recordOrderOperationAudit({
    orderId: cancelled._id,
    actorAdminId: opts.adminId,
    type: 'STATUS_TRANSITION',
    actionId: 'AGE_VERIFICATION_FAILED',
    fromStatus: 'OUT_FOR_DELIVERY',
    toStatus: 'CANCELLED',
    reason: opts.note?.trim() || 'AGE_VERIFICATION_FAILED'
  });

  return {
    ok: true as const,
    status: cancelled.status,
    userStatusChanged: before.kycStatus !== user.kycStatus
  };
}

export async function adminAssignOrder(opts: { orderId: string; assignedToAdminId: string; actorAdminId: string }) {
  const oid = ensureObjectId(opts.orderId);
  const aid = ensureObjectId(opts.assignedToAdminId);
  if (!oid || !aid) return { ok: false as const, errorCode: 'INVALID_ID' as const };
  const order = await OrderModel.findById(oid).exec();
  if (!order) return { ok: false as const, errorCode: 'NOT_FOUND' as const };
  const assignee = await AdminUserModel.findOne({ _id: aid, isActive: true }).select({ _id: 1 }).lean().exec();
  if (!assignee) return { ok: false as const, errorCode: 'NOT_FOUND' as const };
  const previousAssignedToAdminId = order.assignedToAdminId ? new mongoose.Types.ObjectId(order.assignedToAdminId) : null;
  order.assignedToAdminId = aid as any;
  order.assignedAt = new Date();
  await order.save();
  await recordOrderOperationAudit({
    orderId: order._id,
    actorAdminId: opts.actorAdminId,
    type: 'ASSIGNMENT',
    actionId: previousAssignedToAdminId ? 'REASSIGN' : 'ASSIGN',
    previousAssignedToAdminId,
    assignedToAdminId: aid,
    reason: previousAssignedToAdminId ? 'reassigned' : 'assigned'
  });
  return { ok: true as const };
}

export async function adminUnassignOrder(opts: { orderId: string; actorAdminId: string }) {
  const oid = ensureObjectId(opts.orderId);
  if (!oid) return { ok: false as const, errorCode: 'INVALID_ID' as const };
  const order = await OrderModel.findById(oid).exec();
  if (!order) return { ok: false as const, errorCode: 'NOT_FOUND' as const };
  const previousAssignedToAdminId = order.assignedToAdminId ? new mongoose.Types.ObjectId(order.assignedToAdminId) : null;
  order.assignedToAdminId = undefined;
  order.assignedAt = undefined;
  await order.save();
  if (previousAssignedToAdminId) {
    await recordOrderOperationAudit({
      orderId: order._id,
      actorAdminId: opts.actorAdminId,
      type: 'ASSIGNMENT',
      actionId: 'UNASSIGN',
      previousAssignedToAdminId,
      assignedToAdminId: null,
      reason: 'unassigned'
    });
  }
  return { ok: true as const };
}

export async function getAdminOrderDetail(opts: { orderId: string }) {
  const oid = ensureObjectId(opts.orderId);
  if (!oid) return null;

  const order = (await OrderModel.findById(oid).lean().exec()) as any | null;
  if (!order) return null;

  const [user, assignedAdmin, latestPaymentTx] = await Promise.all([
    UserModel.findById(order.userId)
      .select({ email: 1, phone: 1, name: 1, kycStatus: 1, kycVerifiedAt: 1, kycRejectedAt: 1, kycRejectionReason: 1 })
      .lean()
      .exec(),
    order.assignedToAdminId
      ? AdminUserModel.findById(order.assignedToAdminId).select({ email: 1, role: 1 }).lean().exec()
      : Promise.resolve(null),
    PaymentTransactionModel.findOne({ orderId: oid }).sort({ createdAt: -1 }).lean().exec()
  ]);

  const actions = buildOrderActionDescriptors({
    order: {
      status: order.status as OrderStatus,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      progressBlockedReason: order.progressBlockedReason
    },
    userKycStatus: (user as any)?.kycStatus
  });

  const blockedConditions = Array.from(new Set(actions.filter((action) => !action.allowed).map((action) => action.reasonCode).filter(Boolean)));
  const totalUnits = (order.items ?? []).reduce((sum: number, item: any) => sum + Number(item.qty ?? 0), 0);
  const hasReservedStock = order.status !== 'CANCELLED' && order.status !== 'DELIVERED';
  const hasDeductedStock = order.status === 'DELIVERED';
  const assignmentHistoryRaw = await OrderOperationAuditModel.find({ orderId: oid, type: 'ASSIGNMENT' })
    .sort({ createdAt: -1 })
    .limit(10)
    .lean()
    .exec();
  const assignmentActorIds = Array.from(
    new Set(
      assignmentHistoryRaw
        .flatMap((entry: any) => [entry.actorAdminId?.toString?.(), entry.previousAssignedToAdminId?.toString?.(), entry.assignedToAdminId?.toString?.()])
        .filter(Boolean)
    )
  ) as string[];
  const assignmentAdminLookup =
    assignmentActorIds.length > 0
      ? await AdminUserModel.find({ _id: { $in: assignmentActorIds.map((id) => new mongoose.Types.ObjectId(id)) } })
          .select({ email: 1, role: 1 })
          .lean()
          .exec()
      : [];
  const adminById = new Map<string, any>(assignmentAdminLookup.map((admin: any) => [admin._id.toString(), admin]));

  return {
      order: {
        id: order._id.toString(),
        orderNumber: order.orderNumber,
        status: order.status,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        kycGateStatus: order.kycGateStatus,
        kycStatusSnapshot: order.kycStatusSnapshot,
        deliveryAgeCheckRequired: Boolean(order.deliveryAgeCheckRequired),
        progressBlockedReason: order.progressBlockedReason,
        ageVerificationNote: order.ageVerificationNote,
        ageVerificationUpdatedAt: order.ageVerificationUpdatedAt?.toISOString?.(),
        ageVerificationUpdatedByAdminId: order.ageVerificationUpdatedByAdminId?.toString?.(),
        addressSnapshot: order.addressSnapshot,
      subtotal: order.subtotal,
      discount: order.discount,
      deliveryFee: order.deliveryFee,
      total: order.total,
      promoSnapshot: order.promoSnapshot,
      cancelReason: order.cancelReason,
      cancelledAt: order.cancelledAt?.toISOString?.(),
      deliveredAt: order.deliveredAt?.toISOString?.(),
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString()
    },
    customer: {
      userId: order.userId?.toString?.(),
      name: (user as any)?.name,
      email: (user as any)?.email,
      phone: (user as any)?.phone,
      serviceArea: order.addressSnapshot?.area,
      addressSnapshot: order.addressSnapshot
    },
    items: (order.items ?? []).map((item: any) => ({
      productId: item.productId?.toString?.() ?? String(item.productId),
      variantId: item.variantId?.toString?.() ?? String(item.variantId),
      productName: item.productName,
      brandName: item.brandName,
      sku: item.sku,
      volumeMl: item.volumeMl,
      packSize: item.packSize,
      imageUrl: item.imageUrl,
      unitPrice: item.unitPrice,
      qty: item.qty,
      lineTotal: item.lineTotal
    })),
    totals: {
      subtotal: order.subtotal,
      discount: order.discount,
      deliveryFee: order.deliveryFee,
      total: order.total,
      promoApplied: order.promoSnapshot?.code ?? undefined
    },
    operational: {
      currentStatus: order.status,
      allowedActions: actions.filter((action) => action.allowed),
      blockingConditions: blockedConditions
    },
    actions,
    assignment: {
      assignedOperator: assignedAdmin
        ? {
            id: (assignedAdmin as any)._id.toString(),
            email: (assignedAdmin as any).email,
            role: (assignedAdmin as any).role
          }
        : null,
      assignedAt: order.assignedAt?.toISOString?.(),
      history: assignmentHistoryRaw.map((entry: any) => ({
        id: entry._id.toString(),
        actionId: entry.actionId,
        createdAt: entry.createdAt?.toISOString?.(),
        actor: entry.actorAdminId
          ? {
              id: entry.actorAdminId.toString(),
              email: adminById.get(entry.actorAdminId.toString())?.email,
              role: adminById.get(entry.actorAdminId.toString())?.role
            }
          : null,
        previousAssignedTo: entry.previousAssignedToAdminId
          ? {
              id: entry.previousAssignedToAdminId.toString(),
              email: adminById.get(entry.previousAssignedToAdminId.toString())?.email,
              role: adminById.get(entry.previousAssignedToAdminId.toString())?.role
            }
          : null,
        assignedTo: entry.assignedToAdminId
          ? {
              id: entry.assignedToAdminId.toString(),
              email: adminById.get(entry.assignedToAdminId.toString())?.email,
              role: adminById.get(entry.assignedToAdminId.toString())?.role
            }
          : null
      }))
    },
    payment: {
      method: order.paymentMethod,
      status: order.paymentStatus,
      amount: order.total,
      transaction: latestPaymentTx
        ? {
            id: (latestPaymentTx as any)._id.toString(),
            provider: (latestPaymentTx as any).provider,
            status: (latestPaymentTx as any).status,
            amount: (latestPaymentTx as any).amount,
            currency: (latestPaymentTx as any).currency,
            providerReference: (latestPaymentTx as any).providerReference,
            failureReason: (latestPaymentTx as any).failureReason,
            createdAt: (latestPaymentTx as any).createdAt?.toISOString?.(),
            updatedAt: (latestPaymentTx as any).updatedAt?.toISOString?.()
          }
        : null
    },
    inventory: {
      stockReserved: hasReservedStock,
      stockDeducted: hasDeductedStock,
      reservedUnits: hasReservedStock ? totalUnits : 0,
      deductedUnits: hasDeductedStock ? totalUnits : 0,
      reservationTimestamp: order.createdAt.toISOString()
    },
    kyc: {
      gateStatus: order.kycGateStatus,
      status: (user as any)?.kycStatus ?? order.kycStatusSnapshot,
      statusSnapshot: order.kycStatusSnapshot,
      deliveryAgeCheckRequired: Boolean(order.deliveryAgeCheckRequired),
      progressBlockedReason: order.progressBlockedReason,
      ageVerificationNote: order.ageVerificationNote,
      ageVerificationUpdatedAt: order.ageVerificationUpdatedAt?.toISOString?.(),
      verifiedAt: (user as any)?.kycVerifiedAt?.toISOString?.(),
      rejectedAt: (user as any)?.kycRejectedAt?.toISOString?.(),
      rejectionReason: (user as any)?.kycRejectionReason,
      blockedReason:
        blockedConditions.includes('KYC_REQUIRED')
          ? 'KYC must be re-verified before this order can advance.'
          : blockedConditions.includes('KYC_REVIEW_REQUIRED')
          ? 'KYC review required before this order can advance.'
          : order.kycGateStatus === 'FAIL'
            ? 'KYC failed for this customer.'
            : undefined
    },
    audit: {
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
      cancelledAt: order.cancelledAt?.toISOString?.(),
      deliveredAt: order.deliveredAt?.toISOString?.(),
      cancelReason: order.cancelReason,
      createdBy: {
        type: 'customer',
        userId: order.userId?.toString?.()
      },
      updatedBy: null
    }
  };
}
