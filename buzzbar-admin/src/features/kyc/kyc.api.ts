import { api } from '../../lib/api/client.js';
import type { AdminKycQueueResponse, AdminKycUserResponse } from './kyc.types.js';

export type KycQueueParams = {
  status: 'pending' | 'verified' | 'rejected';
  sort: 'newest' | 'oldest';
  autoDecision?: 'auto_verified' | 'needs_review';
  reasonToken?: string;
  minClientConfidence?: number;
  minServerConfidence?: number;
  submittedFrom?: string; // ISO
  submittedTo?: string; // ISO (exclusive)
  page: number;
  limit: number;
};

export async function adminListKycQueue(params: KycQueueParams) {
  const res = await api.get('/api/v1/admin/kyc/queue', { params });
  return res.data?.data as AdminKycQueueResponse;
}

export async function adminGetUserKyc(userId: string) {
  const res = await api.get(`/api/v1/admin/kyc/${userId}`);
  return res.data?.data as AdminKycUserResponse;
}

export async function adminApproveKyc(userId: string) {
  const res = await api.post(`/api/v1/admin/kyc/${userId}/approve`);
  return res.data?.data as { ok: true; userId: string; attemptId: string };
}

export async function adminRejectKyc(userId: string, reason: string) {
  const res = await api.post(`/api/v1/admin/kyc/${userId}/reject`, { reason });
  return res.data?.data as { ok: true; userId: string; attemptId: string };
}

export async function adminVerifyKycManually(userId: string, note: string) {
  const res = await api.post(`/api/v1/admin/kyc/${userId}/verify-manually`, { note });
  return res.data?.data as { ok: true; userId: string; attemptId?: string };
}
