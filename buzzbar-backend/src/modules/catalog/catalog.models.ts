import mongoose, { Schema } from 'mongoose';

const cloudinaryAssetSchema = new Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true },
    width: { type: Number },
    height: { type: Number },
    format: { type: String }
  },
  { _id: false }
);

const categorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    sortOrder: { type: Number, required: true, default: 0 },
    isActive: { type: Boolean, required: true, default: true }
  },
  { timestamps: true, versionKey: false }
);

export const CategoryModel =
  mongoose.models.Category ?? mongoose.model('Category', categorySchema);

const brandSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    logo: { type: cloudinaryAssetSchema },
    isActive: { type: Boolean, required: true, default: true }
  },
  { timestamps: true, versionKey: false }
);

export const BrandModel = mongoose.models.Brand ?? mongoose.model('Brand', brandSchema);

const productSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    brandId: { type: Schema.Types.ObjectId, ref: 'Brand', required: true, index: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true, index: true },
    description: { type: String, trim: true },
    abv: { type: Number, min: 0, max: 100 },
    images: { type: [cloudinaryAssetSchema], default: () => [] },
    isActive: { type: Boolean, required: true, default: true, index: true }
  },
  { timestamps: true, versionKey: false }
);

productSchema.index({ name: 'text', description: 'text' });
productSchema.index({ isActive: 1, brandId: 1, categoryId: 1, createdAt: -1 });

export const ProductModel =
  mongoose.models.Product ?? mongoose.model('Product', productSchema);

const variantSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    sku: { type: String, required: true, unique: true, trim: true },
    volumeMl: { type: Number, required: true, min: 1 },
    packSize: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 }, // NPR integer
    mrp: { type: Number, min: 0 },
    isActive: { type: Boolean, required: true, default: true }
  },
  { timestamps: true, versionKey: false }
);

variantSchema.index({ productId: 1, isActive: 1, price: 1, volumeMl: 1 });

export const VariantModel =
  mongoose.models.Variant ?? mongoose.model('Variant', variantSchema);

export type CloudinaryAsset = {
  url: string;
  publicId: string;
  width?: number;
  height?: number;
  format?: string;
};
