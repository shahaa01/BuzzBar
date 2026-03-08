import type { CloudinaryAsset } from '../brands/brands.types.js';

export type CategoryAdminRow = {
  id: string;
  name: string;
  slug: string;
  image?: CloudinaryAsset;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ListCategoriesResponse = {
  items: CategoryAdminRow[];
  page: number;
  limit: number;
  total: number;
};

export type GetCategoryResponse = CategoryAdminRow;

export type CreateCategoryRequest = {
  name: string;
  slug?: string;
  sortOrder?: number;
  isActive?: boolean;
};

export type UpdateCategoryRequest = {
  name?: string;
  slug?: string;
  image?: CloudinaryAsset | null;
  sortOrder?: number;
  isActive?: boolean;
};

export type CategoryWriteResult = {
  _id: string;
  name: string;
  slug: string;
  image?: CloudinaryAsset;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};
