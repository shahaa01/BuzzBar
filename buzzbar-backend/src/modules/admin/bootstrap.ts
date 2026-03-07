import type { Env } from '../../config/env.js';
import { createLogger } from '../../config/logger.js';
import { hashPassword } from './admin.password.js';
import { AdminUserModel, SETTINGS_SINGLETON_ID, SettingsModel } from './admin.models.js';

const log = createLogger();

async function ensureSettingsDoc() {
  await SettingsModel.updateOne(
    { _id: SETTINGS_SINGLETON_ID },
    { $setOnInsert: { _id: SETTINGS_SINGLETON_ID } },
    { upsert: true }
  );
}

export async function bootstrapAdminPhase(env: Env) {
  await ensureSettingsDoc();

  const superAdminExists = await AdminUserModel.exists({ role: 'superadmin', isActive: true });
  if (superAdminExists) return;

  const email = env.SUPERADMIN_BOOTSTRAP_EMAIL?.toLowerCase().trim();
  const password = env.SUPERADMIN_BOOTSTRAP_PASSWORD;

  if (!email || !password) {
    throw new Error(
      'No SuperAdmin exists. Set SUPERADMIN_BOOTSTRAP_EMAIL and SUPERADMIN_BOOTSTRAP_PASSWORD to bootstrap.'
    );
  }

  const existingByEmail = await AdminUserModel.findOne({ email });
  if (existingByEmail) {
    // If a user exists but isn't superadmin/active, do not silently upgrade.
    throw new Error(
      `Bootstrap email already exists (${email}). Please login and promote manually, or choose another bootstrap email.`
    );
  }

  const passwordHash = await hashPassword(password);
  const created = await AdminUserModel.create({
    email,
    passwordHash,
    role: 'superadmin',
    isActive: true
  });

  log.warn({ adminId: created._id.toString(), email }, 'Bootstrapped initial SuperAdmin');
}

