import { api } from '../../lib/api/client.js';
import type { AdminPromotionsListResponse, PromotionDetail, PromotionListItem, PromotionSort, PromotionStatus, PromotionType, PromotionUpsertInput } from './promotions.types.js';

export type ListPromotionsParams = {
  q?: string;
  type?: PromotionType | 'all';
  isActive?: 'active' | 'inactive' | 'all';
  state?: PromotionStatus | 'all';
  from?: string;
  to?: string;
  sort?: PromotionSort;
  page: number;
  limit: number;
};

export async function adminListPromotions(params: ListPromotionsParams) {
  const res = await api.get('/api/v1/admin/promotions', { params });
  return res.data?.data as AdminPromotionsListResponse;
}

export async function adminGetPromotion(id: string) {
  const res = await api.get(`/api/v1/admin/promotions/${id}`);
  return res.data?.data as PromotionDetail;
}

export async function adminDeactivatePromotion(id: string) {
  const res = await api.delete(`/api/v1/admin/promotions/${id}`);
  return res.data?.data as PromotionListItem;
}

export async function adminCreatePromotion(body: PromotionUpsertInput) {
  const res = await api.post('/api/v1/admin/promotions', body);
  return res.data?.data as PromotionListItem;
}

export async function adminUpdatePromotion(id: string, body: PromotionUpsertInput) {
  const res = await api.put(`/api/v1/admin/promotions/${id}`, body);
  return res.data?.data as PromotionListItem;
}
