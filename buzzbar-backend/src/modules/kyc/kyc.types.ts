export type KycAttemptStatus = 'pending' | 'verified' | 'rejected';

export type DobSource = 'AD' | 'BS' | 'UNKNOWN';

export type KycAutoDecision = 'auto_verified' | 'needs_review';

export type KycImageMeta = {
  url: string;
  publicId: string;
  format?: string;
  width?: number;
  height?: number;
  size: number;
  sha256: string;
};

export type DobParseResult = {
  dobAD?: Date;
  dobBS?: string;
  dobSource: DobSource;
  confidence: number;
  errors: string[];
};

export type OcrResult = {
  text: string;
  confidence: number;
};

