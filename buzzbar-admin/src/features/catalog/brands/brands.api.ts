import { api } from '../../../lib/api/client.js';
import type { BrandWriteResult, CreateBrandRequest, GetBrandResponse, ListBrandsResponse, UpdateBrandRequest } from './brands.types.js';

export async function adminListBrands(input: {
  q?: string;
  isActive?: 'active' | 'inactive' | 'all';
  page: number;
  limit: 20 | 50 | 100;
}): Promise<ListBrandsResponse> {
  const res = await api.get('/api/v1/admin/brands', { params: input });
  return res.data.data as ListBrandsResponse;
}

export async function adminGetBrand(id: string): Promise<GetBrandResponse> {
  const res = await api.get(`/api/v1/admin/brands/${encodeURIComponent(id)}`);
  return res.data.data as GetBrandResponse;
}

export async function adminCreateBrand(body: CreateBrandRequest): Promise<BrandWriteResult> {
  const res = await api.post('/api/v1/admin/brands', body);
  return res.data.data as BrandWriteResult;
}

export async function adminUpdateBrand(id: string, body: UpdateBrandRequest): Promise<BrandWriteResult> {
  const res = await api.put(`/api/v1/admin/brands/${encodeURIComponent(id)}`, body);
  return res.data.data as BrandWriteResult;
}

export async function adminDeactivateBrand(id: string) {
  const res = await api.delete(`/api/v1/admin/brands/${encodeURIComponent(id)}`);
  return res.data.data as { ok: boolean };
}

