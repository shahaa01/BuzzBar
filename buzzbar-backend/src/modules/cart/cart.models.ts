import mongoose, { Schema } from 'mongoose';

const cartItemSchema = new Schema(
  {
    variantId: { type: Schema.Types.ObjectId, ref: 'Variant', required: true },
    qty: { type: Number, required: true, min: 1 },
    addedAt: { type: Date, required: true, default: () => new Date() }
  },
  { _id: false }
);

const cartSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    items: { type: [cartItemSchema], required: true, default: () => [] },
    appliedPromoCode: { type: String }
  },
  { timestamps: true, versionKey: false }
);

export const CartModel = mongoose.models.Cart ?? mongoose.model('Cart', cartSchema);

