import mongoose, { Schema } from 'mongoose';
import type { KycStatus } from './user.types.js';

const addressSchema = new Schema(
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

const userSchema = new Schema(
  {
    email: { type: String, lowercase: true, trim: true },
    emailVerified: { type: Boolean, default: false },
    passwordHash: { type: String },

    providers: {
      password: {
        email: { type: String, lowercase: true, trim: true }
      },
      google: {
        sub: { type: String }
      },
      apple: {
        sub: { type: String }
      }
    },

    phone: { type: String, trim: true },
    name: { type: String, trim: true },
    photoUrl: { type: String, trim: true },

    addresses: { type: [addressSchema], default: () => [] },

    kycStatus: {
      type: String,
      required: true,
      enum: ['not_started', 'pending', 'verified', 'rejected'] satisfies KycStatus[],
      default: 'not_started'
    },
    kycVerifiedAt: { type: Date },
    kycLastAttemptId: { type: Schema.Types.ObjectId, ref: 'KycAttempt' },
    kycRejectedAt: { type: Date },
    kycRejectionReason: { type: String }
  },
  { timestamps: true }
);

userSchema.index({ 'providers.google.sub': 1 }, { unique: true, sparse: true });
userSchema.index({ 'providers.apple.sub': 1 }, { unique: true, sparse: true });
userSchema.index({ 'providers.password.email': 1 }, { unique: true, sparse: true });
userSchema.index({ email: 1 }, { unique: true, sparse: true });
userSchema.index({ kycStatus: 1 });

export const UserModel = mongoose.models.User ?? mongoose.model('User', userSchema);

const userSessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    refreshTokenHash: { type: String, required: true, unique: true, index: true },
    createdAt: { type: Date, required: true, default: () => new Date() },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date },
    replacedBySessionId: { type: Schema.Types.ObjectId, ref: 'UserSession' },
    ip: { type: String },
    userAgent: { type: String }
  },
  { timestamps: false }
);

userSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const UserSessionModel =
  mongoose.models.UserSession ?? mongoose.model('UserSession', userSessionSchema);
