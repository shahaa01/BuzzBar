import mongoose, { Schema } from 'mongoose';

export type OrderStatus =
  | 'CREATED'
  | 'KYC_PENDING_REVIEW'
  | 'CONFIRMED'
  | 'PACKING'
  | 'READY_FOR_DISPATCH'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELLED';

export type PaymentMethod = 'COD' | 'WALLET';
export type PaymentStatus = 'UNPAID' | 'PENDING' | 'PAID' | 'FAILED';

export type KycGateStatus = 'PASS' | 'REVIEW_REQUIRED' | 'FAIL';
export type OrderProgressBlockedReason = 'KYC_REQUIRED' | 'AGE_VERIFICATION_FAILED';

const addressSnapshotSchema = new Schema(
  {
    label: { type: String },
    fullAddress: { type: String },
    area: { type: String },
    landmark: { type: String },
    lat: { type: Number },
    lng: { type: Number },
    contactName: { type: String },
    contactPhone: { type: String }
  },
  { _id: false }
);

const orderItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    variantId: { type: Schema.Types.ObjectId, ref: 'Variant', required: true },
    productName: { type: String, required: true },
    brandName: { type: String },
    sku: { type: String },
    volumeMl: { type: Number, required: true },
    packSize: { type: Number, required: true },
    imageUrl: { type: String },
    unitPrice: { type: Number, required: true }, // integer NPR
    qty: { type: Number, required: true, min: 1 },
    lineTotal: { type: Number, required: true } // integer NPR
  },
  { _id: false }
);

const promoSnapshotSchema = new Schema(
  {
    code: { type: String, required: true },
    type: { type: String, required: true, enum: ['PERCENT', 'FLAT'] },
    value: { type: Number, required: true },
    discountAmount: { type: Number, required: true },
    maxDiscountApplied: { type: Boolean }
  },
  { _id: false }
);

const orderSchema = new Schema(
  {
    orderNumber: { type: String, required: true, unique: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    status: {
      type: String,
      required: true,
      enum: [
        'CREATED',
        'KYC_PENDING_REVIEW',
        'CONFIRMED',
        'PACKING',
        'READY_FOR_DISPATCH',
        'OUT_FOR_DELIVERY',
        'DELIVERED',
        'CANCELLED'
      ] satisfies OrderStatus[],
      index: true
    },

    paymentMethod: { type: String, required: true, enum: ['COD', 'WALLET'] satisfies PaymentMethod[] },
    paymentStatus: {
      type: String,
      required: true,
      enum: ['UNPAID', 'PENDING', 'PAID', 'FAILED'] satisfies PaymentStatus[],
      index: true
    },

    kycGateStatus: { type: String, required: true, enum: ['PASS', 'REVIEW_REQUIRED', 'FAIL'] satisfies KycGateStatus[], index: true },
    kycStatusSnapshot: { type: String, required: true, enum: ['not_started', 'pending', 'verified', 'rejected'] },
    deliveryAgeCheckRequired: { type: Boolean, required: true, default: false },
    progressBlockedReason: { type: String, enum: ['KYC_REQUIRED', 'AGE_VERIFICATION_FAILED'] satisfies OrderProgressBlockedReason[] },
    ageVerificationNote: { type: String },
    ageVerificationUpdatedAt: { type: Date },
    ageVerificationUpdatedByAdminId: { type: Schema.Types.ObjectId, ref: 'AdminUser' },

    addressSnapshot: { type: addressSnapshotSchema, required: true },
    items: { type: [orderItemSchema], required: true, default: () => [] },
    promoSnapshot: { type: promoSnapshotSchema },

    subtotal: { type: Number, required: true }, // integer
    discount: { type: Number, required: true }, // integer
    deliveryFee: { type: Number, required: true }, // integer
    total: { type: Number, required: true }, // integer

    assignedToAdminId: { type: Schema.Types.ObjectId, ref: 'AdminUser' },
    assignedAt: { type: Date },

    cancelReason: { type: String },
    cancelledAt: { type: Date },
    deliveredAt: { type: Date }
  },
  { timestamps: true, versionKey: false }
);

orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ paymentStatus: 1, createdAt: -1 });

export const OrderModel = mongoose.models.Order ?? mongoose.model('Order', orderSchema);

const orderCounterSchema = new Schema(
  {
    _id: { type: String, required: true }, // year
    seq: { type: Number, required: true, default: 0 }
  },
  { timestamps: false, versionKey: false }
);

export const OrderCounterModel =
  mongoose.models.OrderCounter ?? mongoose.model('OrderCounter', orderCounterSchema);

const orderOperationAuditSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    type: { type: String, required: true, enum: ['STATUS_TRANSITION', 'ASSIGNMENT'], index: true },
    actionId: { type: String, required: true, index: true },
    actorAdminId: { type: Schema.Types.ObjectId, ref: 'AdminUser', required: true, index: true },
    fromStatus: {
      type: String,
      enum: ['CREATED', 'KYC_PENDING_REVIEW', 'CONFIRMED', 'PACKING', 'READY_FOR_DISPATCH', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED']
    },
    toStatus: {
      type: String,
      enum: ['CREATED', 'KYC_PENDING_REVIEW', 'CONFIRMED', 'PACKING', 'READY_FOR_DISPATCH', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED']
    },
    previousAssignedToAdminId: { type: Schema.Types.ObjectId, ref: 'AdminUser' },
    assignedToAdminId: { type: Schema.Types.ObjectId, ref: 'AdminUser' },
    reason: { type: String }
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

orderOperationAuditSchema.index({ orderId: 1, createdAt: -1 });

export const OrderOperationAuditModel =
  mongoose.models.OrderOperationAudit ?? mongoose.model('OrderOperationAudit', orderOperationAuditSchema);
