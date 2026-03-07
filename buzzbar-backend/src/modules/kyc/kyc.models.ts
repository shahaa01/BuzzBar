import mongoose, { Schema } from 'mongoose';
import type { DobSource, KycAttemptStatus, KycAutoDecision } from './kyc.types.js';

const kycImageSchema = new Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true },
    format: { type: String },
    width: { type: Number },
    height: { type: Number },
    size: { type: Number, required: true },
    sha256: { type: String, required: true }
  },
  { _id: false }
);

const kycAttemptSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: {
      type: String,
      required: true,
      enum: ['pending', 'verified', 'rejected'] satisfies KycAttemptStatus[],
      index: true
    },

    submittedAt: { type: Date, required: true, default: () => new Date(), index: true },
    supersededAt: { type: Date, index: true },
    supersededByAttemptId: { type: Schema.Types.ObjectId, ref: 'KycAttempt' },
    reviewedAt: { type: Date },
    reviewedByAdminId: { type: Schema.Types.ObjectId, ref: 'AdminUser' },
    reviewDecision: { type: String },
    reviewReason: { type: String },

    idFront: { type: kycImageSchema, required: true },
    idBack: { type: kycImageSchema },
    selfie: { type: kycImageSchema },

    clientOcrText: { type: String },
    clientDobRaw: { type: String },
    clientConfidence: { type: Number },
    serverOcrText: { type: String },
    serverDobRaw: { type: String },
    serverConfidence: { type: Number },

    clientDobAD: { type: Date },
    serverDobAD: { type: Date },
    clientDobBS: { type: String },
    serverDobBS: { type: String },
    clientDobSource: {
      type: String,
      required: true,
      enum: ['AD', 'BS', 'UNKNOWN'] satisfies DobSource[],
      default: 'UNKNOWN'
    },
    serverDobSource: {
      type: String,
      required: true,
      enum: ['AD', 'BS', 'UNKNOWN'] satisfies DobSource[],
      default: 'UNKNOWN'
    },
    dobDifferenceDays: { type: Number },
    clientParseConfidence: { type: Number },
    serverParseConfidence: { type: Number },
    parseConfidence: { type: Number },
    clientParseErrors: { type: [String], default: () => [] },
    serverParseErrors: { type: [String], default: () => [] },
    parseErrors: { type: [String], default: () => [] },

    legalAgeMin: { type: Number },
    evaluatedAt: { type: Date },
    ageYears: { type: Number },

    autoDecision: {
      type: String,
      required: true,
      enum: ['auto_verified', 'needs_review'] satisfies KycAutoDecision[]
    },
    autoDecisionReason: { type: String }
  },
  { timestamps: false, versionKey: false }
);

kycAttemptSchema.index({ status: 1, submittedAt: -1 });
kycAttemptSchema.index({ userId: 1, submittedAt: -1 });

export const KycAttemptModel =
  mongoose.models.KycAttempt ?? mongoose.model('KycAttempt', kycAttemptSchema);
