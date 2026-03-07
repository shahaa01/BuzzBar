import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import type { AdminRole } from './admin.types.js';

const adminUserSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, required: true, enum: ['superadmin', 'admin', 'employee'] satisfies AdminRole[] },
    isActive: { type: Boolean, default: true },
    createdByAdminId: { type: Schema.Types.ObjectId, ref: 'AdminUser' }
  },
  { timestamps: true }
);

export type AdminUserDoc = InferSchemaType<typeof adminUserSchema> & { _id: mongoose.Types.ObjectId };

export const AdminUserModel =
  mongoose.models.AdminUser ?? mongoose.model('AdminUser', adminUserSchema);

const adminSessionSchema = new Schema(
  {
    adminId: { type: Schema.Types.ObjectId, ref: 'AdminUser', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, index: true },
    createdAt: { type: Date, required: true, default: () => new Date() },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date },
    replacedBySessionId: { type: Schema.Types.ObjectId, ref: 'AdminSession' },
    ip: { type: String },
    userAgent: { type: String }
  },
  { timestamps: false }
);

adminSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AdminSessionModel =
  mongoose.models.AdminSession ?? mongoose.model('AdminSession', adminSessionSchema);

const settingsSchema = new Schema(
  {
    _id: { type: String, required: true },
    nightHours: {
      start: { type: String, required: true, default: '22:00' },
      end: { type: String, required: true, default: '06:00' },
      timezone: { type: String, required: true, default: 'Asia/Kathmandu' }
    },
    serviceAreas: {
      type: [String],
      required: true,
      default: () => ['Kathmandu', 'Lalitpur', 'Bhaktapur']
    },
    deliveryFeeFlat: { type: Number, required: true, default: 0 },
    legalAgeMin: { type: Number, required: true, default: 18 }
  },
  { timestamps: true, versionKey: false }
);

export const SETTINGS_SINGLETON_ID = 'singleton';

export const SettingsModel =
  mongoose.models.Settings ?? mongoose.model('Settings', settingsSchema);

const adminAuditLogSchema = new Schema(
  {
    adminId: { type: Schema.Types.ObjectId, ref: 'AdminUser', required: true, index: true },
    action: { type: String, required: true, index: true },
    entityType: { type: String, required: true, index: true },
    entityId: { type: String },
    before: { type: Schema.Types.Mixed },
    after: { type: Schema.Types.Mixed },
    meta: { type: Schema.Types.Mixed }
  },
  { timestamps: true, versionKey: false }
);

export const AdminAuditLogModel =
  mongoose.models.AdminAuditLog ?? mongoose.model('AdminAuditLog', adminAuditLogSchema);
