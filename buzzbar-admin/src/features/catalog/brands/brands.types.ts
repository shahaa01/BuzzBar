export type CloudinaryAsset = {
  url: string;
  publicId: string;
  width?: number;
  height?: number;
  format?: string;
};

export type BrandAdminRow = {
  id: string;
  name: string;
  slug: string;
  logo?: CloudinaryAsset;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ListBrandsResponse = {
  items: BrandAdminRow[];
  page: number;
  limit: number;
  total: number;
};

export type GetBrandResponse = BrandAdminRow;

export type CreateBrandRequest = {
  name: string;
  slug?: string;
  isActive?: boolean;
};

export type UpdateBrandRequest = {
  name?: string;
  slug?: string;
  logo?: CloudinaryAsset | null;
  isActive?: boolean;
};

export type BrandWriteResult = {
  _id: string;
  name: string;
  slug: string;
  logo?: CloudinaryAsset;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

