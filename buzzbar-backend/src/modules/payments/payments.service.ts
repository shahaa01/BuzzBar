import mongoose from 'mongoose';
import { OrderModel } from '../orders/orders.models.js';
import { releaseReservedStockLines } from '../orders/orders.stock.js';
import { PaymentTransactionModel } from './payments.models.js';
import { getPaymentProvider, normalizeProviderId } from './payments.providers.js';
import type { PaymentProviderId, PaymentTransactionStatus } from './payments.types.js';
import { UserModel } from '../user/user.models.js';

function ensureObjectId(id: string) {
  if (!mongoose.isValidObjectId(id)) return null;
  return new mongoose.Types.ObjectId(id);
}

function floorInt(n: number) {
  return Math.floor(n);
}

function getWalletPendingTimeoutMinutes() {
  const raw = Number(process.env.WALLET_PENDING_TIMEOUT_MIN ?? '30');
  if (!Number.isFinite(raw)) return 30;
  return Math.max(1, Math.round(raw));
}

function buildStalePendingCutoff() {
  return new Date(Date.now() - getWalletPendingTimeoutMinutes() * 60 * 1000);
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isMockProvider(provider: unknown) {
  return String(provider ?? '').toUpperCase() === 'MOCK';
}

function isFinalStatus(status: unknown) {
  return status === 'SUCCESS' || status === 'FAILED';
}

function buildMockLifecycle(tx: any) {
  if (!isMockProvider(tx?.provider)) return null;

  const createdAt = tx?.createdAt instanceof Date ? tx.createdAt.toISOString() : new Date(tx?.createdAt).toISOString();
  const updatedAt = tx?.updatedAt instanceof Date ? tx.updatedAt.toISOString() : new Date(tx?.updatedAt).toISOString();
  const result = String((tx?.responsePayload as any)?.result ?? '');
  const steps: Array<{ id: string; label: string; at: string; state: 'done' | 'pending' | 'failed' }> = [
    { id: 'INIT_REQUESTED', label: 'Init requested', at: createdAt, state: 'done' as const },
    { id: 'INIT_SUCCESS', label: 'Init completed', at: createdAt, state: 'done' as const }
  ];

  if (tx?.status !== 'INITIATED') {
    steps.push({ id: 'CONFIRM_REQUESTED', label: 'Confirm attempted', at: updatedAt, state: 'done' as const });
  }
  if (tx?.status === 'PENDING' || result === 'PENDING') {
    steps.push({ id: 'CONFIRM_PENDING', label: 'Confirm pending', at: updatedAt, state: 'pending' as const });
  }
  if (tx?.status === 'SUCCESS' || result === 'SUCCESS') {
    steps.push({ id: 'CONFIRM_SUCCESS', label: 'Confirm succeeded', at: updatedAt, state: 'done' as const });
  }
  if (tx?.status === 'FAILED' || result === 'FAILED') {
    steps.push({ id: 'CONFIRM_FAILED', label: 'Confirm failed', at: updatedAt, state: 'failed' as const });
  }

  return {
    providerPath: 'MOCK',
    steps
  };
}

function buildDiagnosticSummary(tx: any) {
  const stalePending = tx?.status === 'PENDING' && new Date(tx?.createdAt).getTime() < buildStalePendingCutoff().getTime();
  const pendingAgeMinutes = tx?.status === 'PENDING' ? Math.max(0, Math.floor((Date.now() - new Date(tx?.createdAt).getTime()) / 60000)) : undefined;
  let operatorHint = undefined as string | undefined;

  if (stalePending) operatorHint = 'Payment initiated but not finalized within the expected window.';
  else if (tx?.status === 'FAILED' && tx?.failureReason === 'mock_failed') operatorHint = 'Mock provider returned a failed confirmation result.';
  else if (tx?.status === 'FAILED') operatorHint = 'Provider rejected the payment or confirmation failed.';
  else if (tx?.status === 'PENDING') operatorHint = 'Payment initiated but still waiting for final confirmation.';
  else if (tx?.status === 'INITIATED') operatorHint = 'Payment was initiated and has not reached confirm flow yet.';

  return {
    stalePending,
    pendingAgeMinutes,
    operatorHint,
    providerResult: (tx?.responsePayload as any)?.result,
    mockLifecycle: buildMockLifecycle(tx)
  };
}

function isTerminalTxStatus(status: PaymentTransactionStatus) {
  return status === 'SUCCESS' || status === 'FAILED';
}

async function ensureOrderPaidAndMaybeConfirmed(order: any) {
  if (order.paymentStatus !== 'PAID') order.paymentStatus = 'PAID';
  if (order.status === 'CREATED') order.status = 'CONFIRMED';
  await order.save();
}

async function ensureOrderFailedAndCancelled(order: any) {
  if (order.paymentStatus !== 'FAILED') order.paymentStatus = 'FAILED';
  if (order.status !== 'CANCELLED' && order.status !== 'DELIVERED') {
    const lines = (order.items as any[]).map((it) => ({ variantId: it.variantId as mongoose.Types.ObjectId, qty: Number(it.qty) }));
    await releaseReservedStockLines(lines);
    order.status = 'CANCELLED';
    order.cancelReason = 'payment_failed';
    order.cancelledAt = new Date();
  }
  await order.save();
}

export async function initPayment(opts: { userId: string; orderId: string; provider: string }) {
  const providerId = normalizeProviderId(opts.provider);
  if (!providerId) return { ok: false as const, errorCode: 'PAYMENT_PROVIDER_NOT_SUPPORTED' as const };
  const provider = getPaymentProvider(providerId);
  if (!provider) return { ok: false as const, errorCode: 'PAYMENT_PROVIDER_NOT_SUPPORTED' as const, details: { supported: ['MOCK'] } };

  const uid = ensureObjectId(opts.userId);
  const oid = ensureObjectId(opts.orderId);
  if (!uid || !oid) return { ok: false as const, errorCode: 'PAYMENT_INVALID_ORDER' as const };

  const order = await OrderModel.findOne({ _id: oid, userId: uid }).exec();
  if (!order) return { ok: false as const, errorCode: 'PAYMENT_INVALID_ORDER' as const };
  if (order.paymentMethod !== 'WALLET') return { ok: false as const, errorCode: 'PAYMENT_INVALID_METHOD' as const };
  if (order.status === 'CANCELLED' || order.status === 'DELIVERED') return { ok: false as const, errorCode: 'PAYMENT_ALREADY_TERMINAL' as const };
  if (order.paymentStatus === 'PAID' || order.paymentStatus === 'FAILED') return { ok: false as const, errorCode: 'PAYMENT_ALREADY_TERMINAL' as const };

  const existing = await PaymentTransactionModel.findOne({ orderId: oid, provider: providerId }).sort({ createdAt: -1 }).exec();
  if (existing) {
    if (existing.status === 'INITIATED' || existing.status === 'PENDING') {
      return { ok: true as const, transactionId: existing._id.toString(), status: existing.status, provider: existing.provider };
    }
    if (isTerminalTxStatus(existing.status as PaymentTransactionStatus)) {
      return { ok: false as const, errorCode: 'PAYMENT_ALREADY_TERMINAL' as const };
    }
  }

  const tx = await PaymentTransactionModel.create({
    orderId: oid,
    userId: uid,
    provider: providerId,
    paymentMethod: order.paymentMethod,
    status: 'INITIATED',
    amount: floorInt(Number(order.total)),
    currency: 'NPR',
    requestPayload: { orderNumber: order.orderNumber }
  });

  const initRes = await provider.init({ orderId: order._id.toString(), amount: tx.amount, currency: tx.currency });
  tx.status = initRes.status;
  if (initRes.providerReference) tx.providerReference = initRes.providerReference;
  if (initRes.responsePayload !== undefined) tx.responsePayload = initRes.responsePayload;
  await tx.save();

  return { ok: true as const, transactionId: tx._id.toString(), status: tx.status, provider: tx.provider, amount: tx.amount, currency: tx.currency };
}

export async function confirmPayment(opts: { userId: string; orderId: string; provider: string; payload: unknown }) {
  const providerId = normalizeProviderId(opts.provider);
  if (!providerId) return { ok: false as const, errorCode: 'PAYMENT_PROVIDER_NOT_SUPPORTED' as const };
  const provider = getPaymentProvider(providerId);
  if (!provider) return { ok: false as const, errorCode: 'PAYMENT_PROVIDER_NOT_SUPPORTED' as const, details: { supported: ['MOCK'] } };

  const uid = ensureObjectId(opts.userId);
  const oid = ensureObjectId(opts.orderId);
  if (!uid || !oid) return { ok: false as const, errorCode: 'PAYMENT_INVALID_ORDER' as const };

  const order = await OrderModel.findOne({ _id: oid, userId: uid }).exec();
  if (!order) return { ok: false as const, errorCode: 'PAYMENT_INVALID_ORDER' as const };
  if (order.paymentMethod !== 'WALLET') return { ok: false as const, errorCode: 'PAYMENT_INVALID_METHOD' as const };

  let tx = await PaymentTransactionModel.findOne({ orderId: oid, provider: providerId }).sort({ createdAt: -1 }).exec();
  if (!tx) return { ok: false as const, errorCode: 'PAYMENT_TRANSACTION_NOT_FOUND' as const };

  const txStatus = tx.status as PaymentTransactionStatus;
  if (txStatus === 'SUCCESS') {
    if (order.paymentStatus !== 'PAID') await ensureOrderPaidAndMaybeConfirmed(order);
    return { ok: true as const, status: 'SUCCESS' as const, orderPaymentStatus: order.paymentStatus, orderStatus: order.status };
  }
  if (txStatus === 'FAILED') {
    if (order.paymentStatus !== 'FAILED' || order.status !== 'CANCELLED') await ensureOrderFailedAndCancelled(order);
    return { ok: true as const, status: 'FAILED' as const, orderPaymentStatus: order.paymentStatus, orderStatus: order.status };
  }

  if (order.status === 'CANCELLED' || order.status === 'DELIVERED') {
    return { ok: false as const, errorCode: 'PAYMENT_ALREADY_TERMINAL' as const };
  }
  if (order.paymentStatus === 'PAID' || order.paymentStatus === 'FAILED') {
    return { ok: false as const, errorCode: 'PAYMENT_ALREADY_TERMINAL' as const };
  }

  const confirmRes = await provider.confirm({ transactionStatus: txStatus, payload: opts.payload });

  const nextTxStatus = confirmRes.status as PaymentTransactionStatus;
  const updated = await PaymentTransactionModel.findOneAndUpdate(
    { _id: tx._id, status: tx.status },
    {
      $set: {
        status: nextTxStatus,
        providerReference: confirmRes.providerReference ?? tx.providerReference,
        responsePayload: confirmRes.responsePayload ?? tx.responsePayload,
        failureReason: confirmRes.failureReason ?? undefined
      }
    },
    { new: true }
  ).exec();

  if (!updated) {
    tx = await PaymentTransactionModel.findById(tx._id).exec();
    if (!tx) return { ok: false as const, errorCode: 'PAYMENT_TRANSACTION_NOT_FOUND' as const };
    const s = tx.status as PaymentTransactionStatus;
    if (s === 'SUCCESS') {
      if (order.paymentStatus !== 'PAID') await ensureOrderPaidAndMaybeConfirmed(order);
      return { ok: true as const, status: 'SUCCESS' as const, orderPaymentStatus: order.paymentStatus, orderStatus: order.status };
    }
    if (s === 'FAILED') {
      if (order.paymentStatus !== 'FAILED' || order.status !== 'CANCELLED') await ensureOrderFailedAndCancelled(order);
      return { ok: true as const, status: 'FAILED' as const, orderPaymentStatus: order.paymentStatus, orderStatus: order.status };
    }
    return { ok: true as const, status: s, orderPaymentStatus: order.paymentStatus, orderStatus: order.status };
  }

  tx = updated;

  if (nextTxStatus === 'PENDING') {
    return { ok: true as const, status: 'PENDING' as const, orderPaymentStatus: order.paymentStatus, orderStatus: order.status };
  }
  if (nextTxStatus === 'SUCCESS') {
    await ensureOrderPaidAndMaybeConfirmed(order);
    return { ok: true as const, status: 'SUCCESS' as const, orderPaymentStatus: order.paymentStatus, orderStatus: order.status };
  }
  if (nextTxStatus === 'FAILED') {
    await ensureOrderFailedAndCancelled(order);
    return { ok: true as const, status: 'FAILED' as const, orderPaymentStatus: order.paymentStatus, orderStatus: order.status };
  }

  return { ok: false as const, errorCode: 'PAYMENT_CONFIRMATION_FAILED' as const };
}

export async function adminListPaymentTransactions(opts: { provider?: PaymentProviderId; status?: PaymentTransactionStatus; page: number; limit: number }) {
  const filter: any = {};
  if (opts.provider) filter.provider = opts.provider;
  if (opts.status) filter.status = opts.status;
  const skip = (opts.page - 1) * opts.limit;
  const [items, total] = await Promise.all([
    PaymentTransactionModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(opts.limit).lean(),
    PaymentTransactionModel.countDocuments(filter)
  ]);
  return { items, total };
}

export async function adminGetPaymentTransaction(opts: { id: string }) {
  const pid = ensureObjectId(opts.id);
  if (!pid) return null;
  return PaymentTransactionModel.findById(pid).lean();
}

export async function adminListPaymentTransactionsDetailed(opts: {
  provider?: PaymentProviderId;
  status?: PaymentTransactionStatus;
  paymentMethod?: 'COD' | 'WALLET';
  from?: string;
  to?: string;
  q?: string;
  stalePending?: boolean;
  sort?: 'createdAt_desc' | 'createdAt_asc' | 'amount_desc' | 'amount_asc' | 'updatedAt_desc';
  page: number;
  limit: number;
}) {
  const filter: any = {};
  if (opts.provider) filter.provider = opts.provider;
  if (opts.status) filter.status = opts.status;
  if (opts.paymentMethod) filter.paymentMethod = opts.paymentMethod;

  const fromDate = opts.from ? new Date(opts.from) : null;
  const toDate = opts.to ? new Date(opts.to) : null;
  if (fromDate || toDate) {
    filter.createdAt = {};
    if (fromDate) filter.createdAt.$gte = fromDate;
    if (toDate) filter.createdAt.$lt = toDate;
  }

  if (opts.stalePending) {
    filter.status = 'PENDING';
    filter.createdAt = { ...(filter.createdAt ?? {}), $lt: buildStalePendingCutoff() };
  }

  const q = opts.q?.trim();
  if (q) {
    const re = new RegExp(escapeRe(q), 'i');
    const matchingOrders = await OrderModel.find({ orderNumber: re }).select({ _id: 1 }).limit(100).lean().exec();
    const matchingUsers = await UserModel.find({ $or: [{ email: re }, { name: re }, { phone: re }] }).select({ _id: 1 }).limit(100).lean().exec();
    const orderIds = matchingOrders.map((order: any) => order._id);
    const userIds = matchingUsers.map((user: any) => user._id);

    filter.$and = [
      ...(filter.$and ?? []),
      {
        $or: [
          { providerReference: { $regex: re } },
          ...(mongoose.isValidObjectId(q) ? [{ _id: new mongoose.Types.ObjectId(q) }] : []),
          ...(orderIds.length > 0 ? [{ orderId: { $in: orderIds } }] : []),
          ...(userIds.length > 0 ? [{ userId: { $in: userIds } }] : [])
        ]
      }
    ];
  }

  const skip = (opts.page - 1) * opts.limit;
  const sort: Record<string, 1 | -1> =
    opts.sort === 'createdAt_asc'
      ? { createdAt: 1, _id: 1 }
      : opts.sort === 'amount_desc'
        ? { amount: -1, createdAt: -1, _id: -1 }
        : opts.sort === 'amount_asc'
          ? { amount: 1, createdAt: -1, _id: -1 }
          : opts.sort === 'updatedAt_desc'
            ? { updatedAt: -1, _id: -1 }
            : { createdAt: -1, _id: -1 };

  const [items, total] = await Promise.all([
    PaymentTransactionModel.aggregate([
      { $match: filter },
      { $sort: sort },
      { $skip: skip },
      { $limit: opts.limit },
      {
        $lookup: {
          from: OrderModel.collection.name,
          localField: 'orderId',
          foreignField: '_id',
          as: 'order'
        }
      },
      { $addFields: { order: { $ifNull: [{ $first: '$order' }, null] } } },
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
        $project: {
          _id: { $toString: '$_id' },
          provider: 1,
          paymentMethod: 1,
          status: 1,
          amount: 1,
          currency: 1,
          providerReference: 1,
          createdAt: 1,
          updatedAt: 1,
          order: {
            id: { $cond: [{ $ifNull: ['$order._id', false] }, { $toString: '$order._id' }, null] },
            orderNumber: '$order.orderNumber',
            status: '$order.status',
            paymentStatus: '$order.paymentStatus',
            total: '$order.total'
          },
          user: {
            id: { $cond: [{ $ifNull: ['$user._id', false] }, { $toString: '$user._id' }, null] },
            email: '$user.email',
            phone: '$user.phone',
            name: '$user.name'
          }
        }
      }
    ]).exec(),
    PaymentTransactionModel.countDocuments(filter)
  ]);

  return {
    items: items.map((item: any) => ({
      ...item,
      isMock: isMockProvider(item.provider),
      finality: isFinalStatus(item.status) ? 'FINAL' : 'OPEN',
      stalePending: item.status === 'PENDING' && new Date(item.createdAt).getTime() < buildStalePendingCutoff().getTime()
    })),
    total
  };
}

export async function adminGetPaymentTransactionDetailed(opts: { id: string }) {
  const pid = ensureObjectId(opts.id);
  if (!pid) return null;

  const tx = (await PaymentTransactionModel.findById(pid).lean().exec()) as any | null;
  if (!tx) return null;

  const [order, user] = await Promise.all([
    OrderModel.findById(tx.orderId)
      .select({ orderNumber: 1, status: 1, paymentMethod: 1, paymentStatus: 1, total: 1, createdAt: 1 })
      .lean()
      .exec(),
    UserModel.findById(tx.userId).select({ email: 1, phone: 1, name: 1 }).lean().exec()
  ]);

  const diagnostics = buildDiagnosticSummary(tx);

  return {
    payment: {
      id: tx._id.toString(),
      provider: tx.provider,
      paymentMethod: tx.paymentMethod,
      status: tx.status,
      amount: tx.amount,
      currency: tx.currency,
      providerReference: tx.providerReference,
      failureReason: tx.failureReason,
      createdAt: tx.createdAt?.toISOString?.() ?? new Date(tx.createdAt).toISOString(),
      updatedAt: tx.updatedAt?.toISOString?.() ?? new Date(tx.updatedAt).toISOString(),
      isMock: isMockProvider(tx.provider),
      isFinal: isFinalStatus(tx.status)
    },
    order: order
      ? {
          id: (order as any)._id.toString(),
          orderNumber: (order as any).orderNumber,
          status: (order as any).status,
          paymentMethod: (order as any).paymentMethod,
          paymentStatus: (order as any).paymentStatus,
          total: (order as any).total,
          createdAt: (order as any).createdAt?.toISOString?.()
        }
      : null,
    user: user
      ? {
          id: (user as any)._id.toString(),
          email: (user as any).email,
          phone: (user as any).phone,
          name: (user as any).name
        }
      : null,
    snapshots: {
      request: tx.requestPayload ?? null,
      response: tx.responsePayload ?? null
    },
    diagnostics: {
      failureReason: tx.failureReason,
      requestId: (tx.responsePayload as any)?.requestId ?? (tx.requestPayload as any)?.requestId,
      operatorHint: diagnostics.operatorHint,
      stalePending: diagnostics.stalePending,
      pendingAgeMinutes: diagnostics.pendingAgeMinutes,
      providerResult: diagnostics.providerResult,
      mockLifecycle: diagnostics.mockLifecycle
    }
  };
}
