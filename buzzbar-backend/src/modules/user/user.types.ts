export type KycStatus = 'not_started' | 'pending' | 'verified' | 'rejected';

export type UserProvider = 'password' | 'google' | 'apple';

export type UserPublic = {
  id: string;
  email?: string;
  emailVerified?: boolean;
  phone?: string;
  name?: string;
  photoUrl?: string;
  kycStatus: KycStatus;
  createdAt: string;
  updatedAt: string;
};

