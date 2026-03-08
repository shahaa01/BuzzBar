import { api } from '../../../lib/api/client.js';
import type { CategoryWriteResult, CreateCategoryRequest, GetCategoryResponse, ListCategoriesResponse, UpdateCategoryRequest } from './categories.types.js';

export async function adminListCategories(input: {
  q?: string;
  isActive?: 'active' | 'inactive' | 'all';
  page: number;
  limit: 20 | 50 | 100;
}): Promise<ListCategoriesResponse> {
  const res = await api.get('/api/v1/admin/categories', { params: input });
  return res.data.data as ListCategoriesResponse;
}

export async function adminGetCategory(id: string): Promise<GetCategoryResponse> {
  const res = await api.get(`/api/v1/admin/categories/${encodeURIComponent(id)}`);
  return res.data.data as GetCategoryResponse;
}

export async function adminCreateCategory(body: CreateCategoryRequest): Promise<CategoryWriteResult> {
  const res = await api.post('/api/v1/admin/categories', body);
  return res.data.data as CategoryWriteResult;
}

export async function adminUpdateCategory(id: string, body: UpdateCategoryRequest): Promise<CategoryWriteResult> {
  const res = await api.put(`/api/v1/admin/categories/${encodeURIComponent(id)}`, body);
  return res.data.data as CategoryWriteResult;
}

export async function adminDeactivateCategory(id: string) {
  const res = await api.delete(`/api/v1/admin/categories/${encodeURIComponent(id)}`);
  return res.data.data as { ok: boolean };
}
