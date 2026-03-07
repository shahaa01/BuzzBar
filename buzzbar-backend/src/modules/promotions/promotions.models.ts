import mongoose, { Schema } from 'mongoose';

const promotionSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, index: true }, // stored uppercase
    type: { type: String, required: true, enum: ['PERCENT', 'FLAT'] },
    value: { type: Number, required: true, min: 0 },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    minSubtotal: { type: Number, min: 0 },
    maxDiscount: { type: Number, min: 0 },
    usageLimitTotal: { type: Number, min: 0 },
    usageLimitPerUser: { type: Number, min: 0 },
    isActive: { type: Boolean, required: true, default: true, index: true },

    eligibleCategoryIds: { type: [Schema.Types.ObjectId], ref: 'Category', default: undefined },
    eligibleBrandIds: { type: [Schema.Types.ObjectId], ref: 'Brand', default: undefined },
    eligibleProductIds: { type: [Schema.Types.ObjectId], ref: 'Product', default: undefined },
    excludeDiscountedItems: { type: Boolean, default: false }
  },
  { timestamps: true, versionKey: false }
);

promotionSchema.index({ isActive: 1, startAt: 1, endAt: 1 });

export const PromotionModel =
  mongoose.models.Promotion ?? mongoose.model('Promotion', promotionSchema);

const promoUsageSchema = new Schema(
  {
    promoId: { type: Schema.Types.ObjectId, ref: 'Promotion', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    usedCount: { type: Number, required: true, min: 0, default: 0 }
  },
  { timestamps: true, versionKey: false }
);

promoUsageSchema.index({ promoId: 1, userId: 1 }, { unique: true });

export const PromoUsageModel =
  mongoose.models.PromoUsage ?? mongoose.model('PromoUsage', promoUsageSchema);

