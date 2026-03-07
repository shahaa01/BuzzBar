import type { UserPublic } from './user.types.js';

export function toUserPublic(doc: any): UserPublic {
  return {
    id: doc._id.toString(),
    email: doc.email ?? undefined,
    emailVerified: doc.emailVerified ?? undefined,
    phone: doc.phone ?? undefined,
    name: doc.name ?? undefined,
    photoUrl: doc.photoUrl ?? undefined,
    kycStatus: doc.kycStatus,
    createdAt: doc.createdAt?.toISOString?.() ?? String(doc.createdAt),
    updatedAt: doc.updatedAt?.toISOString?.() ?? String(doc.updatedAt)
  };
}

