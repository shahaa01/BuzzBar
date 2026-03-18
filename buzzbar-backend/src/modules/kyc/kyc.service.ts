import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import type { Express } from 'express';
import { SETTINGS_SINGLETON_ID, SettingsModel } from '../admin/admin.models.js';
import { uploadImageToCloudinary } from '../uploads/cloudinary.service.js';
import type { KycImageMeta } from './kyc.types.js';
import { decideKyc } from './kyc.decision.js';
import { getKycOcrProvider } from './kyc.ocr.js';
import { KycAttemptModel } from './kyc.models.js';
import { UserModel } from '../user/user.models.js';
import { clearOpenOrderAgeVerificationFlags } from '../orders/orders.service.js';

export const MAX_KYC_FILE_SIZE_BYTES = 7 * 1024 * 1024;
export const KYC_ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

function sha256Hex(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function ensureSettings() {
  await SettingsModel.updateOne(
    { _id: SETTINGS_SINGLETON_ID },
    { $setOnInsert: { _id: SETTINGS_SINGLETON_ID } },
    { upsert: true }
  );
  return SettingsModel.findById(SETTINGS_SINGLETON_ID).lean();
}

function getKycConfidenceThreshold() {
  const n = Number(process.env.KYC_CONFIDENCE_THRESHOLD ?? '0.7');
  if (!Number.isFinite(n)) return 0.7;
  return Math.max(0, Math.min(1, n));
}

function getDobToleranceDays() {
  const n = Number(process.env.KYC_DOB_TOLERANCE_DAYS ?? '90');
  if (!Number.isFinite(n)) return 90;
  return Math.max(0, Math.round(n));
}

async function uploadKycImage(opts: { buffer: Buffer; folder: string; file: Express.Multer.File }): Promise<KycImageMeta> {
  const asset = await uploadImageToCloudinary({ buffer: opts.buffer, folder: opts.folder, type: 'private' });
  return {
    url: asset.url,
    publicId: asset.publicId,
    format: asset.format,
    width: asset.width,
    height: asset.height,
    size: opts.file.size,
    sha256: sha256Hex(opts.buffer)
  };
}

export async function submitKycAttempt(opts: {
  userId: string;
  files: { idFront: Express.Multer.File; idBack?: Express.Multer.File; selfie?: Express.Multer.File };
  clientOcrText?: string;
  clientDobRaw?: string;
  clientConfidence?: number;
}) {
  const user = await UserModel.findById(opts.userId);
  if (!user) return { ok: false as const, error: 'USER_NOT_FOUND' as const };
  if (user.kycStatus === 'verified') return { ok: false as const, error: 'ALREADY_VERIFIED' as const };

  const settings = await ensureSettings();
  const legalAgeMin = Number((settings as any)?.legalAgeMin ?? 18);
  const timezone = String((settings as any)?.nightHours?.timezone ?? 'Asia/Kathmandu');

  const attemptId = new mongoose.Types.ObjectId();
  const priorPendingAttemptId = user.kycStatus === 'pending' ? user.kycLastAttemptId?.toString?.() : undefined;
  const folderBase = `buzzbar/kyc/${opts.userId}/${attemptId.toString()}`;

  const [idFront, idBack, selfie] = await Promise.all([
    uploadKycImage({ buffer: opts.files.idFront.buffer, folder: `${folderBase}/front`, file: opts.files.idFront }),
    opts.files.idBack
      ? uploadKycImage({ buffer: opts.files.idBack.buffer, folder: `${folderBase}/back`, file: opts.files.idBack })
      : Promise.resolve(undefined),
    opts.files.selfie
      ? uploadKycImage({ buffer: opts.files.selfie.buffer, folder: `${folderBase}/selfie`, file: opts.files.selfie })
      : Promise.resolve(undefined)
  ]);

  const ocr = getKycOcrProvider();
  const [frontOcr, backOcr] = await Promise.all([
    ocr.recognize({ buffer: opts.files.idFront.buffer, filename: opts.files.idFront.originalname }),
    opts.files.idBack
      ? ocr.recognize({ buffer: opts.files.idBack.buffer, filename: opts.files.idBack.originalname })
      : Promise.resolve(undefined)
  ]);

  const serverOcrText = [frontOcr.text, backOcr?.text].filter(Boolean).join('\n').trim();
  const serverConfidence = Math.max(frontOcr.confidence, backOcr?.confidence ?? 0);

  const decision = decideKyc({
    legalAgeMin,
    timezone,
    evaluatedAt: new Date(),
    confidenceThreshold: getKycConfidenceThreshold(),
    dobToleranceDays: getDobToleranceDays(),
    client: {
      ocrText: opts.clientOcrText,
      dobRaw: opts.clientDobRaw,
      confidence: opts.clientConfidence
    },
    server: {
      ocrText: serverOcrText,
      confidence: serverConfidence
    }
  });

  const status = decision.autoDecision === 'auto_verified' ? 'verified' : 'pending';

  const attempt = await KycAttemptModel.create({
    _id: attemptId,
    userId: user._id,
    status,
    submittedAt: new Date(),
    reviewedAt: status === 'verified' ? new Date() : undefined,
    reviewDecision: status === 'verified' ? 'auto_verified' : undefined,

    idFront,
    idBack,
    selfie,

    clientOcrText: opts.clientOcrText,
    clientDobRaw: decision.clientDobRaw ?? opts.clientDobRaw,
    clientConfidence: typeof opts.clientConfidence === 'number' ? opts.clientConfidence : undefined,
    serverOcrText,
    serverDobRaw: decision.serverDobRaw,
    serverConfidence,

    clientDobAD: decision.clientParsed.dobAD,
    serverDobAD: decision.serverParsed.dobAD,
    clientDobBS: decision.clientParsed.dobBS,
    serverDobBS: decision.serverParsed.dobBS,
    clientDobSource: decision.clientParsed.dobSource,
    serverDobSource: decision.serverParsed.dobSource,
    dobDifferenceDays: decision.dobDifferenceDays,
    clientParseConfidence: decision.clientParsed.confidence,
    serverParseConfidence: decision.serverParsed.confidence,
    parseConfidence: decision.parseConfidence,
    clientParseErrors: decision.clientParsed.errors,
    serverParseErrors: decision.serverParsed.errors,
    parseErrors: decision.parseErrors,

    legalAgeMin,
    evaluatedAt: new Date(),
    ageYears: decision.ageYears,

    autoDecision: decision.autoDecision,
    autoDecisionReason: decision.autoDecisionReason
  });

  user.kycLastAttemptId = attemptId;
  user.kycRejectionReason = undefined;
  user.kycRejectedAt = undefined;

  if (status === 'verified') {
    user.kycStatus = 'verified';
    user.kycVerifiedAt = new Date();
  } else {
    user.kycStatus = 'pending';
    user.kycVerifiedAt = undefined;
  }

  await user.save();
  if (status === 'verified') {
    await clearOpenOrderAgeVerificationFlags({ userId: user._id.toString(), note: 'auto_verified_kyc' });
  }

  // Re-submit behavior: always create a new attempt and supersede the previous pending attempt (if any).
  if (priorPendingAttemptId) {
    await KycAttemptModel.updateOne(
      { _id: priorPendingAttemptId, userId: user._id, status: 'pending', supersededAt: { $exists: false } },
      { $set: { supersededAt: new Date(), supersededByAttemptId: attemptId } }
    );
  }

  return {
    ok: true as const,
    attemptId: attempt._id.toString(),
    kycStatus: user.kycStatus,
    autoDecision: decision.autoDecision,
    attempt
  };
}
