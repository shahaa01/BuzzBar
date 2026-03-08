import { api } from '../../lib/api/client.js';
import type { AdminInventoryListResponse, AdminInventoryMovementsResponse, InventoryAdjustResponse } from './inventory.types.js';

export type ListInventoryParams = {
  page: number;
  limit: number;
  productId?: string;
  brandId?: string;
  categoryId?: string;
  lowStock?: number;
};

export async function adminListInventory(params: ListInventoryParams) {
  const res = await api.get('/api/v1/admin/inventory', { params });
  return res.data?.data as AdminInventoryListResponse;
}

export async function adminAdjustInventory(opts: { variantId: string; delta: number; reason: string }) {
  const res = await api.patch('/api/v1/admin/inventory/adjust', opts);
  return res.data?.data as InventoryAdjustResponse;
}

export type ListInventoryMovementsParams = {
  q?: string;
  actor?: string;
  type?: 'RECEIVE' | 'ADJUST' | 'SALE' | 'RETURN';
  from?: string; // ISO
  to?: string; // ISO (exclusive)
  page: number;
  limit: number;
};

export async function adminListInventoryMovements(params: ListInventoryMovementsParams) {
  const res = await api.get('/api/v1/admin/inventory/movements', { params });
  return res.data?.data as AdminInventoryMovementsResponse;
}

