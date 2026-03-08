import mongoose, { Schema } from 'mongoose';

const inventoryStockSchema = new Schema(
  {
    variantId: { type: Schema.Types.ObjectId, ref: 'Variant', required: true, unique: true },
    quantity: { type: Number, required: true, min: 0, default: 0 },
    reserved: { type: Number, required: true, min: 0, default: 0 }
  },
  { timestamps: true, versionKey: false }
);

export const InventoryStockModel =
  mongoose.models.InventoryStock ?? mongoose.model('InventoryStock', inventoryStockSchema);

const inventoryMovementSchema = new Schema(
  {
    variantId: { type: Schema.Types.ObjectId, ref: 'Variant', required: true, index: true },
    type: { type: String, required: true, enum: ['RECEIVE', 'ADJUST', 'SALE', 'RETURN'] },
    delta: { type: Number, required: true },
    reason: { type: String },
    quantityBefore: { type: Number },
    quantityAfter: { type: Number },
    actorAdminId: { type: Schema.Types.ObjectId, ref: 'AdminUser', required: true, index: true }
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

inventoryMovementSchema.index({ createdAt: -1 });
inventoryMovementSchema.index({ variantId: 1, createdAt: -1 });
inventoryMovementSchema.index({ actorAdminId: 1, createdAt: -1 });

export const InventoryMovementModel =
  mongoose.models.InventoryMovement ?? mongoose.model('InventoryMovement', inventoryMovementSchema);

export function computeAvailability(stock: { quantity?: number; reserved?: number } | null | undefined) {
  const quantity = stock?.quantity ?? 0;
  const reserved = stock?.reserved ?? 0;
  return Math.max(quantity - reserved, 0);
}
