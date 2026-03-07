import { EmptyState } from '../../components/feedback/EmptyState.js';

export function PromotionsPage() {
  return (
    <div className="space-y-4">
      <EmptyState
        title="Promotions module coming later"
        description="Phase 2E will implement promotions management once backend admin endpoints exist."
      />
    </div>
  );
}

