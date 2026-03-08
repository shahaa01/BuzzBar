export type KycAttemptStatus = 'pending' | 'verified' | 'rejected';
export type KycAutoDecision = 'auto_verified' | 'needs_review';

export type KycQueueUser = {
  _id: string;
  email?: string | null;
  phone?: string | null;
  name?: string | null;
  kycStatus: 'not_started' | 'pending' | 'verified' | 'rejected';
};

export type KycAttemptQueueItem = {
  _id: string;
  userId: KycQueueUser;
  status: KycAttemptStatus;
  submittedAt: string;
  reviewedAt?: string;
  autoDecision: KycAutoDecision;
  autoDecisionReason?: string;
  clientConfidence?: number;
  serverConfidence?: number;
  dobDifferenceDays?: number;
  ageYears?: number;
  legalAgeMin?: number;
};

export type AdminKycQueueResponse = {
  items: KycAttemptQueueItem[];
  page: number;
  limit: number;
  total: number;
};

export type KycImageMeta = {
  url: string;
  publicId: string;
  format?: string;
  width?: number;
  height?: number;
  size: number;
  sha256: string;
};

export type KycAttemptDetail = {
  _id: string;
  status: KycAttemptStatus;
  submittedAt: string;
  reviewedAt?: string;
  reviewDecision?: string;
  reviewReason?: string;
  reviewedByAdminId?: unknown;

  idFront: KycImageMeta;
  idBack?: KycImageMeta;
  selfie?: KycImageMeta;

  clientOcrText?: string;
  clientDobRaw?: string;
  clientConfidence?: number;

  serverOcrText?: string;
  serverDobRaw?: string;
  serverConfidence?: number;

  dobDifferenceDays?: number;
  parseConfidence?: number;
  parseErrors?: string[];

  legalAgeMin?: number;
  ageYears?: number;

  autoDecision: KycAutoDecision;
  autoDecisionReason?: string;
};

export type KycAttemptHistoryItem = {
  _id: string;
  status: KycAttemptStatus;
  submittedAt: string;
  supersededAt?: string;
  reviewedAt?: string;
  reviewDecision?: string;
  reviewReason?: string;
  reviewedByAdminId?: unknown;
  autoDecision?: KycAutoDecision;
  autoDecisionReason?: string;
  clientConfidence?: number;
  serverConfidence?: number;
  dobDifferenceDays?: number;
  ageYears?: number;
  legalAgeMin?: number;
};

export type AdminKycUserResponse = {
  user: {
    _id: string;
    email?: string | null;
    phone?: string | null;
    name?: string | null;
    kycStatus: 'not_started' | 'pending' | 'verified' | 'rejected';
    kycLastAttemptId?: string;
    kycVerifiedAt?: string;
    kycRejectedAt?: string;
    kycRejectionReason?: string;
  };
  attempt: KycAttemptDetail | null;
  attemptHistory: KycAttemptHistoryItem[];
};
