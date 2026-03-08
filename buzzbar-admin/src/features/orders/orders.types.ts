export type OrderStatus =
  | 'CREATED'
  | 'KYC_PENDING_REVIEW'
  | 'CONFIRMED'
  | 'PACKING'
  | 'READY_FOR_DISPATCH'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELLED';

export type PaymentMethod = 'COD' | 'WALLET';
export type PaymentStatus = 'UNPAID' | 'PENDING' | 'PAID' | 'FAILED';
export type KycStatusSnapshot = 'not_started' | 'pending' | 'verified' | 'rejected';
export type AdminOrderAction = {
  id: string;
  label: string;
  tone: 'default' | 'destructive';
  to: OrderStatus;
  toStatus: OrderStatus;
  allowed: boolean;
  reasonCode?: string;
};

export type AdminOrderListItem = {
  _id: string;
  orderNumber: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  kycStatusSnapshot: KycStatusSnapshot;
  total: number;
  createdAt: string;
  assignedAt?: string;
  addressSnapshot: {
    area?: string;
  };
  user: {
    id?: string | null;
    email?: string;
    phone?: string;
    name?: string;
    kycStatus?: KycStatusSnapshot;
  } | null;
  assignedTo: {
    id?: string | null;
    email?: string;
    role?: 'superadmin' | 'admin' | 'employee';
  } | null;
  paymentTransaction: {
    id?: string | null;
    provider?: 'MOCK' | 'ESEWA' | 'KHALTI';
    status?: 'INITIATED' | 'PENDING' | 'SUCCESS' | 'FAILED';
    providerReference?: string;
    isMock?: boolean;
  } | null;
  quickActions: AdminOrderAction[];
};

export type AdminOrderDetail = {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  kycGateStatus: 'PASS' | 'REVIEW_REQUIRED' | 'FAIL';
  kycStatusSnapshot: KycStatusSnapshot;
  addressSnapshot: {
    label?: string;
    fullAddress?: string;
    area?: string;
    landmark?: string;
    lat?: number;
    lng?: number;
    contactName?: string;
    contactPhone?: string;
  };
  items: Array<{
    productId: string;
    variantId: string;
    productName: string;
    brandName?: string;
    sku?: string;
    volumeMl: number;
    packSize: number;
    imageUrl?: string;
    unitPrice: number;
    qty: number;
    lineTotal: number;
  }>;
  promoSnapshot?: {
    code: string;
    type: 'PERCENT' | 'FLAT';
    value: number;
    discountAmount: number;
    maxDiscountApplied?: boolean;
  };
  subtotal: number;
  discount: number;
  deliveryFee: number;
  total: number;
  cancelReason?: string;
  cancelledAt?: string;
  deliveredAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type AdminOrderDetailResponse = {
  order: AdminOrderDetail;
  customer: {
    userId?: string;
    email?: string;
    phone?: string;
    name?: string;
    serviceArea?: string;
    addressSnapshot: AdminOrderDetail['addressSnapshot'];
  } | null;
  items: AdminOrderDetail['items'];
  totals: {
    subtotal: number;
    discount: number;
    deliveryFee: number;
    total: number;
    promoApplied?: string;
  };
  actions: AdminOrderAction[];
  operational: {
    currentStatus: OrderStatus;
    allowedActions: AdminOrderAction[];
    blockingConditions: string[];
  };
  assignment: {
    assignedOperator: {
      id: string;
      email: string;
      role: 'superadmin' | 'admin' | 'employee';
    } | null;
    assignedAt?: string;
    history: Array<{
      id: string;
      actionId: 'ASSIGN' | 'REASSIGN' | 'UNASSIGN';
      createdAt?: string;
      actor: {
        id: string;
        email?: string;
        role?: 'superadmin' | 'admin' | 'employee';
      } | null;
      previousAssignedTo: {
        id: string;
        email?: string;
        role?: 'superadmin' | 'admin' | 'employee';
      } | null;
      assignedTo: {
        id: string;
        email?: string;
        role?: 'superadmin' | 'admin' | 'employee';
      } | null;
    }>;
  };
  payment: {
    method: PaymentMethod;
    status: PaymentStatus;
    amount: number;
    transaction: {
      id: string;
      provider: 'MOCK' | 'ESEWA' | 'KHALTI';
      status: 'INITIATED' | 'PENDING' | 'SUCCESS' | 'FAILED';
      amount: number;
      currency: string;
      providerReference?: string;
      failureReason?: string;
      createdAt?: string;
      updatedAt?: string;
    } | null;
  };
  inventory: {
    stockReserved: boolean;
    stockDeducted: boolean;
    reservedUnits: number;
    deductedUnits: number;
    reservationTimestamp: string;
  };
  kyc: {
    gateStatus: 'PASS' | 'REVIEW_REQUIRED' | 'FAIL';
    status: KycStatusSnapshot;
    statusSnapshot: KycStatusSnapshot;
    verifiedAt?: string;
    rejectedAt?: string;
    rejectionReason?: string;
    blockedReason?: string;
  };
  audit: {
    createdAt: string;
    updatedAt: string;
    cancelledAt?: string;
    deliveredAt?: string;
    cancelReason?: string;
    createdBy: {
      type: 'customer';
      userId?: string;
    };
    updatedBy: null;
  };
};

export type AdminOrderAssignee = {
  id: string;
  email: string;
  role: 'superadmin' | 'admin' | 'employee';
};
