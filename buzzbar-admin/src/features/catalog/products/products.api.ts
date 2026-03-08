import { api } from '../../../lib/api/client.js';
import type {
  CreateProductRequest,
  CreateVariantRequest,
  GetProductResponse,
  ListProductsResponse,
  ProductWriteResult,
  UpdateProductRequest,
  UpdateVariantRequest
} from './products.types.js';

export type AdminProductsListParams = {
  q?: string;
  brandId?: string;
  categoryId?: string;
  isActive?: 'active' | 'inactive' | 'all';
  lowStockThreshold?: number;
  sort?:
    | 'name_asc'
    | 'name_desc'
    | 'createdAt_asc'
    | 'createdAt_desc'
    | 'updatedAt_asc'
    | 'updatedAt_desc'
    | 'stockStatus_asc'
    | 'stockStatus_desc';
  page: number;
  limit: 20 | 50 | 100;
};

export async function adminListProducts(params: AdminProductsListParams): Promise<ListProductsResponse> {
  const res = await api.get('/api/v1/admin/products', { params });
  return res.data.data as ListProductsResponse;
}

export async function adminGetProduct(id: string): Promise<GetProductResponse> {
  const res = await api.get(`/api/v1/admin/products/${encodeURIComponent(id)}`);
  return res.data.data as GetProductResponse;
}

export async function adminCreateProduct(body: CreateProductRequest): Promise<ProductWriteResult> {
  const res = await api.post('/api/v1/admin/products', body);
  return res.data.data as ProductWriteResult;
}

export async function adminUpdateProduct(id: string, body: UpdateProductRequest): Promise<ProductWriteResult> {
  const res = await api.put(`/api/v1/admin/products/${encodeURIComponent(id)}`, body);
  return res.data.data as ProductWriteResult;
}

export async function adminDeactivateProduct(id: string) {
  const res = await api.delete(`/api/v1/admin/products/${encodeURIComponent(id)}`);
  return res.data.data as { ok: boolean };
}

export async function adminCreateVariant(productId: string, body: CreateVariantRequest) {
  const res = await api.post(`/api/v1/admin/products/${encodeURIComponent(productId)}/variants`, body);
  return res.data.data as unknown;
}

export async function adminUpdateVariant(variantId: string, body: UpdateVariantRequest) {
  const res = await api.put(`/api/v1/admin/variants/${encodeURIComponent(variantId)}`, body);
  return res.data.data as unknown;
}

export async function adminDeactivateVariant(variantId: string) {
  const res = await api.delete(`/api/v1/admin/variants/${encodeURIComponent(variantId)}`);
  return res.data.data as { ok: boolean };
}
