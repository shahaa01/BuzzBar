import { api } from '../../lib/api/client.js';
import type { AdminPaymentDetailResponse, AdminPaymentListItem, PaymentListSort, PaymentMethod, PaymentProvider, PaymentTransactionStatus } from './payments.types.js';

export type ListPaymentsParams = {
  provider?: PaymentProvider;
  status?: PaymentTransactionStatus;
  paymentMethod?: PaymentMethod;
  from?: string;
  to?: string;
  q?: string;
  stalePending?: boolean;
  sort?: PaymentListSort;
  page: number;
  limit: number;
};

export async function adminListPayments(params: ListPaymentsParams) {
  const res = await api.get('/api/v1/admin/payments', { params });
  return res.data?.data as { items: AdminPaymentListItem[]; page: number; limit: number; total: number };
}

export async function adminGetPaymentTransaction(id: string) {
  const res = await api.get(`/api/v1/admin/payments/${id}`);
  return res.data?.data as AdminPaymentDetailResponse;
}
