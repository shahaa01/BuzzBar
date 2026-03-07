import mongoose from 'mongoose';
import { OrderModel } from '../orders/orders.models.js';
import { releaseReservedStockLines } from '../orders/orders.stock.js';
import { PaymentTransactionModel } from './payments.models.js';
import { getPaymentProvider, normalizeProviderId } from './payments.providers.js';
import type { PaymentProviderId, PaymentTransactionStatus } from './payments.types.js';

function ensureObjectId(id: string) {
  if (!mongoose.isValidObjectId(id)) return null;
  return new mongoose.Types.ObjectId(id);
}

function floorInt(n: number) {
  return Math.floor(n);
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

