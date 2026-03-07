import mongoose from 'mongoose';
import { InventoryStockModel } from '../inventory/inventory.models.js';

export async function reserveStockLines(lines: { variantId: mongoose.Types.ObjectId; qty: number }[]) {
  const reserved: { variantId: mongoose.Types.ObjectId; qty: number }[] = [];

  for (const line of lines) {
    const res = await InventoryStockModel.updateOne(
      {
        variantId: line.variantId,
        $expr: { $gte: [{ $subtract: ['$quantity', '$reserved'] }, line.qty] }
      } as any,
      { $inc: { reserved: line.qty } }
    );

    if ((res as any).modifiedCount !== 1) {
      // rollback
      for (const prev of reserved) {
        await InventoryStockModel.updateOne({ variantId: prev.variantId }, { $inc: { reserved: -prev.qty } });
      }
      return { ok: false as const, errorCode: 'INSUFFICIENT_STOCK' as const };
    }

    reserved.push(line);
  }

  return { ok: true as const };
}

export async function releaseReservedStockLines(lines: { variantId: mongoose.Types.ObjectId; qty: number }[]) {
  for (const line of lines) {
    await InventoryStockModel.updateOne(
      { variantId: line.variantId, $expr: { $gte: ['$reserved', line.qty] } } as any,
      { $inc: { reserved: -line.qty } }
    );
  }
}

export async function commitDeliveredStockLines(lines: { variantId: mongoose.Types.ObjectId; qty: number }[]) {
  for (const line of lines) {
    await InventoryStockModel.updateOne(
      { variantId: line.variantId, $expr: { $gte: ['$reserved', line.qty] } } as any,
      { $inc: { quantity: -line.qty, reserved: -line.qty } }
    );
  }
}
