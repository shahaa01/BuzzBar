import { EmptyState } from '../../components/feedback/EmptyState.js';

export function CatalogPage() {
  return (
    <div className="space-y-4">
      <EmptyState title="Catalog module coming next" description="Phase 2C will implement categories/brands/products/variants + Cloudinary uploads." />
    </div>
  );
}

