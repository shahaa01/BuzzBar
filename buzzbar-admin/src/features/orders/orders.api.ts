import { api } from '../../lib/api/client.js';
import type { AdminOrderAssignee, AdminOrderDetailResponse, AdminOrderListItem } from './orders.types.js';

export type ListOrdersParams = {
  status?: string;
  paymentMethod?: string;
  paymentStatus?: string;
  kycStatusSnapshot?: string;
  assigned?: 'assigned' | 'unassigned';
  serviceArea?: string;
  from?: string;
  to?: string;
  q?: string;
  sort?: 'createdAt_desc' | 'createdAt_asc' | 'total_desc' | 'total_asc';
  page: number;
  limit: number;
};

export async function adminListOrders(params: ListOrdersParams) {
  const res = await api.get('/api/v1/admin/orders', { params });
  const data = res.data?.data as { items: AdminOrderListItem[]; page: number; limit: number; total: number };
  return data;
}

export async function adminGetOrderDetail(id: string) {
  const res = await api.get(`/api/v1/admin/orders/${id}`);
  return res.data?.data as AdminOrderDetailResponse;
}

export async function adminListOrderAssignees() {
  const res = await api.get('/api/v1/admin/orders/assignees');
  return (res.data?.data?.items ?? []) as AdminOrderAssignee[];
}

export async function adminTransitionOrder(opts: { id: string; actionId: string }) {
  const res = await api.post(`/api/v1/admin/orders/${opts.id}/transition`, { actionId: opts.actionId });
  return res.data?.data as { status: string; actionId: string };
}

export async function adminUpdateOrderStatus(opts: { id: string; status: string }) {
  const res = await api.patch(`/api/v1/admin/orders/${opts.id}/status`, { status: opts.status });
  return res.data?.data as { status: string };
}

export async function adminAssignOrder(opts: { id: string; assignedToAdminId: string }) {
  const res = await api.patch(`/api/v1/admin/orders/${opts.id}/assign`, { assignedToAdminId: opts.assignedToAdminId });
  return res.data?.data as { ok: true };
}

export async function adminUnassignOrder(opts: { id: string }) {
  const res = await api.post(`/api/v1/admin/orders/${opts.id}/unassign`);
  return res.data?.data as { ok: true };
}

export async function adminCancelOrder(opts: { id: string; reason?: string }) {
  const res = await api.post(`/api/v1/admin/orders/${opts.id}/cancel`, opts.reason ? { reason: opts.reason } : {});
  return res.data?.data as { ok: true };
}
