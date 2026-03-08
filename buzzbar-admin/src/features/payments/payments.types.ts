export type PaymentProvider = 'MOCK' | 'ESEWA' | 'KHALTI';
export type PaymentMethod = 'COD' | 'WALLET';
export type PaymentTransactionStatus = 'INITIATED' | 'PENDING' | 'SUCCESS' | 'FAILED';

export type PaymentListSort = 'createdAt_desc' | 'createdAt_asc' | 'amount_desc' | 'amount_asc' | 'updatedAt_desc';

export type AdminPaymentListItem = {
  _id: string;
  provider: PaymentProvider;
  paymentMethod: PaymentMethod;
  status: PaymentTransactionStatus;
  amount: number;
  currency: string;
  providerReference?: string;
  createdAt: string;
  updatedAt: string;
  isMock: boolean;
  finality: 'FINAL' | 'OPEN';
  stalePending: boolean;
  order: {
    id?: string | null;
    orderNumber?: string;
    status?: string;
    paymentStatus?: string;
    total?: number;
  } | null;
  user: {
    id?: string | null;
    email?: string;
    phone?: string;
    name?: string;
  } | null;
};

export type AdminPaymentDetailResponse = {
  payment: {
    id: string;
    provider: PaymentProvider;
    paymentMethod: PaymentMethod;
    status: PaymentTransactionStatus;
    amount: number;
    currency: string;
    providerReference?: string;
    failureReason?: string;
    createdAt: string;
    updatedAt: string;
    isMock: boolean;
    isFinal: boolean;
  };
  order: {
    id: string;
    orderNumber: string;
    status: string;
    paymentMethod: PaymentMethod;
    paymentStatus: string;
    total: number;
    createdAt?: string;
  } | null;
  user: {
    id: string;
    email?: string;
    phone?: string;
    name?: string;
  } | null;
  snapshots: {
    request: unknown;
    response: unknown;
  };
  diagnostics: {
    failureReason?: string;
    requestId?: string;
    operatorHint?: string;
    stalePending: boolean;
    pendingAgeMinutes?: number;
    providerResult?: string;
    mockLifecycle: {
      providerPath: string;
      steps: Array<{
        id: string;
        label: string;
        at: string;
        state: 'done' | 'pending' | 'failed';
      }>;
    } | null;
  };
};
