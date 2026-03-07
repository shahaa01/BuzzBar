import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

 const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  MONGO_URI: z.string().min(1, 'MONGO_URI is required')
      .default('mongodb://localhost:27017/buzzbar'),
  CORS_ORIGINS: z.string().optional(),

  ADMIN_JWT_ACCESS_SECRET: z.string().min(16, 'ADMIN_JWT_ACCESS_SECRET must be at least 16 chars'),
  ADMIN_JWT_REFRESH_SECRET: z.string().min(16, 'ADMIN_JWT_REFRESH_SECRET must be at least 16 chars'),
  ADMIN_ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().positive().default(15),
  ADMIN_REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  USER_JWT_ACCESS_SECRET: z.string().min(16, 'USER_JWT_ACCESS_SECRET must be at least 16 chars'),
  USER_JWT_REFRESH_SECRET: z.string().min(16, 'USER_JWT_REFRESH_SECRET must be at least 16 chars'),
  USER_ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().positive().default(15),
  USER_REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  CLOUDINARY_URL: z.string().optional(),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),

  // KYC (P1.4)
  KYC_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.7),
  KYC_DOB_TOLERANCE_DAYS: z.coerce.number().int().min(0).default(90),
  KYC_OCR_MODE: z.enum(['real', 'test', 'fake']).optional(),

  // Payments (P1.8 ops hardening)
  WALLET_PENDING_TIMEOUT_MIN: z.coerce.number().int().positive().optional(),

  // Wallet providers (P1.7b deferred; should not block startup)
  ESEWA_MERCHANT_CODE: z.string().optional(),
  ESEWA_SECRET: z.string().optional(),
  KHALTI_PUBLIC_KEY: z.string().optional(),
  KHALTI_SECRET_KEY: z.string().optional(),

  SUPERADMIN_BOOTSTRAP_EMAIL: z.string().email().optional(),
  SUPERADMIN_BOOTSTRAP_PASSWORD: z.string().min(10).optional(),
  SUPERADMIN_BOOTSTRAP_NAME: z.string().min(1).optional()
});

export type Env = z.infer<typeof envSchema>;

export function getEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${msg}`);
  }
  const env = parsed.data;

  if (env.NODE_ENV !== 'test') {
    const hasCloudinaryUrl = Boolean(env.CLOUDINARY_URL && env.CLOUDINARY_URL.trim().length > 0);
    const hasCloudinaryParts = Boolean(
      env.CLOUDINARY_CLOUD_NAME?.trim() &&
        env.CLOUDINARY_API_KEY?.trim() &&
        env.CLOUDINARY_API_SECRET?.trim()
    );
    if (!hasCloudinaryUrl && !hasCloudinaryParts) {
      throw new Error('Invalid environment: Cloudinary credentials are required (CLOUDINARY_URL or CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET)');
    }
  }

  return env;
}
