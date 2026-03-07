import mongoose, { Schema } from 'mongoose';
import type { PaymentProviderId, PaymentTransactionStatus } from './payments.types.js';

const paymentTransactionSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    provider: { type: String, required: true, enum: ['MOCK', 'ESEWA', 'KHALTI'] satisfies PaymentProviderId[], index: true },
    paymentMethod: { type: String, required: true, enum: ['COD', 'WALLET'], index: true },

    status: {
      type: String,
      required: true,
      enum: ['INITIATED', 'PENDING', 'SUCCESS', 'FAILED'] satisfies PaymentTransactionStatus[],
      index: true
    },

    amount: { type: Number, required: true }, // integer rupees (NPR)
    currency: { type: String, required: true, default: 'NPR' },

    providerReference: { type: String, index: true },
    requestPayload: { type: Schema.Types.Mixed },
    responsePayload: { type: Schema.Types.Mixed },
    failureReason: { type: String }
  },
  { timestamps: true, versionKey: false }
);

paymentTransactionSchema.index({ createdAt: -1 });

export const PaymentTransactionModel =
  mongoose.models.PaymentTransaction ?? mongoose.model('PaymentTransaction', paymentTransactionSchema);

