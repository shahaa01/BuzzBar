export type AdminDashboardSummary = {
  generatedAt: string;
  timeZone: string;
  counts: {
    ordersToday: number;
    ordersPendingReview: number;
    kycPending: number;
    promotionsActive: number;
    inventoryLowStock: number;
    inventoryZeroStock: number;
    walletPending: number;
  };
  statusBreakdown: {
    ordersTodayByStatus: Record<string, number>;
    ordersBacklogByStatus: Record<string, number>;
  };
  kycOldestPending: { submittedAt?: string; waitMinutes?: number };
  inventory: { lowStockThreshold: number };
};

