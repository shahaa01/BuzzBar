import mongoose from 'mongoose';
import type pino from 'pino';
import { OrderModel } from '../modules/orders/orders.models.js';
import { releaseReservedStockLines } from '../modules/orders/orders.stock.js';
import { PaymentTransactionModel } from '../modules/payments/payments.models.js';

function getTimeoutMinutes() {
  const raw = Number(process.env.WALLET_PENDING_TIMEOUT_MIN ?? '30');
  if (!Number.isFinite(raw)) return 30;
  return Math.max(1, Math.round(raw));
}

export async function cleanupStaleWalletOrders(opts: { log: pino.Logger }) {
  const timeoutMin = getTimeoutMinutes();
  const cutoff = new Date(Date.now() - timeoutMin * 60 * 1000);

  // Process in small batches to avoid long-running loops.
  const batchSize = 50;
  let cancelled = 0;

  while (true) {
    const candidates = (await OrderModel.find({
      paymentMethod: 'WALLET',
      paymentStatus: 'PENDING',
      createdAt: { $lt: cutoff },
      status: { $nin: ['CANCELLED', 'DELIVERED'] }
    })
      .sort({ createdAt: 1 })
      .limit(batchSize)
      .lean()
      .exec()) as any[];

    if (candidates.length === 0) break;

    for (const order of candidates) {
      const updated = await OrderModel.findOneAndUpdate(
        {
          _id: order._id,
          paymentMethod: 'WALLET',
          paymentStatus: 'PENDING',
          createdAt: { $lt: cutoff },
          status: { $nin: ['CANCELLED', 'DELIVERED'] }
        } as any,
        {
          $set: {
            paymentStatus: 'FAILED',
            status: 'CANCELLED',
            cancelReason: 'payment_timeout',
            cancelledAt: new Date()
          }
        },
        { new: true }
      ).exec();

      if (!updated) continue;

      const lines = ((updated as any).items ?? []).map((it: any) => ({ variantId: it.variantId as mongoose.Types.ObjectId, qty: Number(it.qty) }));
      await releaseReservedStockLines(lines);

      await PaymentTransactionModel.updateMany(
        { orderId: updated._id, status: { $in: ['INITIATED', 'PENDING'] } },
        { $set: { status: 'FAILED', failureReason: 'timeout' } }
      );

      cancelled += 1;
      opts.log.info({ orderId: updated._id.toString(), orderNumber: (updated as any).orderNumber, timeoutMin }, 'Stale wallet order cancelled');
    }
  }

  if (cancelled > 0) {
    opts.log.info({ cancelled, timeoutMin }, 'Stale wallet cleanup completed');
  }
}

