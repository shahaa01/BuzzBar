import type { CloudinaryAsset } from '../brands/brands.types.js';

export type ProductStockStatus = 'in_stock' | 'low_stock' | 'out_of_stock';

export type ProductAdminListItem = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  brand: { id: string; name: string; slug: string } | null;
  category: { id: string; name: string; slug: string } | null;
  primaryImage?: CloudinaryAsset | null;
  imagesCount: number;
  variantsCount: number;
  stockStatus: ProductStockStatus;
  createdAt: string;
  updatedAt: string;
};

export type ListProductsResponse = {
  items: ProductAdminListItem[];
  page: number;
  limit: number;
  total: number;
};

export type ProductDetail = {
  id: string;
  name: string;
  slug: string;
  brandId: string;
  categoryId: string;
  countryOfOrigin?: string;
  productType?: string;
  subcategory?: string;
  ingredients: string[];
  servingSuggestion?: string;
  agingInfo?: string;
  authenticityNote?: string;
  shortDescription?: string;
  tags: string[];
  description?: string;
  abv?: number;
  images: CloudinaryAsset[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ProductVariantRow = {
  id: string;
  sku: string;
  label?: string;
  volumeMl: number;
  packSize: number;
  price: number;
  mrp?: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  stock: { quantity: number; reserved: number; available: number };
};

export type GetProductResponse = {
  product: ProductDetail;
  variants: ProductVariantRow[];
  brand: { id: string; name: string; slug: string; isActive: boolean } | null;
  category: { id: string; name: string; slug: string; isActive: boolean } | null;
};

export type CreateProductRequest = {
  name: string;
  slug?: string;
  brandId: string;
  categoryId: string;
  countryOfOrigin?: string;
  productType?: string;
  subcategory?: string;
  ingredients?: string[];
  servingSuggestion?: string;
  agingInfo?: string;
  authenticityNote?: string;
  shortDescription?: string;
  tags?: string[];
  description?: string;
  abv?: number;
  images?: CloudinaryAsset[];
  isActive?: boolean;
};

export type UpdateProductRequest = {
  name?: string;
  slug?: string;
  brandId?: string;
  categoryId?: string;
  countryOfOrigin?: string | null;
  productType?: string | null;
  subcategory?: string | null;
  ingredients?: string[];
  servingSuggestion?: string | null;
  agingInfo?: string | null;
  authenticityNote?: string | null;
  shortDescription?: string | null;
  tags?: string[];
  description?: string;
  abv?: number | null;
  images?: CloudinaryAsset[];
  isActive?: boolean;
};

export type ProductWriteResult = {
  _id: string;
  name: string;
  slug: string;
  brandId: string;
  categoryId: string;
  countryOfOrigin?: string;
  productType?: string;
  subcategory?: string;
  ingredients?: string[];
  servingSuggestion?: string;
  agingInfo?: string;
  authenticityNote?: string;
  shortDescription?: string;
  tags?: string[];
  description?: string;
  abv?: number;
  images?: CloudinaryAsset[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CreateVariantRequest = {
  sku: string;
  label?: string;
  volumeMl: number;
  packSize?: number;
  price: number;
  mrp?: number;
  isActive?: boolean;
};

export type UpdateVariantRequest = {
  sku?: string;
  label?: string | null;
  volumeMl?: number;
  packSize?: number;
  price?: number;
  mrp?: number | null;
  isActive?: boolean;
};
