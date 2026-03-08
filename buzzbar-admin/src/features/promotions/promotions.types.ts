export type PromotionStatus = 'live' | 'scheduled' | 'expired' | 'inactive';
export type PromotionValidityStatus = PromotionStatus | 'invalid';
export type PromotionType = 'PERCENT' | 'FLAT';
export type PromotionSort = 'createdAt_desc' | 'createdAt_asc' | 'updatedAt_desc' | 'startsAt_asc' | 'endsAt_asc' | 'usageCount_desc';

export type PromotionEligibilityEntity = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
};

export type PromotionListItem = {
  id: string;
  code: string;
  title: string | null;
  description: string | null;
  type: PromotionType;
  value: number;
  isActive: boolean;
  status: PromotionStatus;
  startAt: string;
  endAt: string;
  minSubtotal: number | null;
  maxDiscount: number | null;
  usageLimitTotal: number | null;
  usageLimitPerUser: number | null;
  usageCount: number;
  usageRemaining: number | null;
  isExhausted: boolean;
  eligibleCategoryIds: string[];
  eligibleBrandIds: string[];
  eligibleProductIds: string[];
  excludeDiscountedItems: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PromotionDetail = PromotionListItem & {
  eligibilitySummary: {
    whoCanUseIt: string;
    whenItApplies: string;
    minOrderAmount: string;
    capExclusionsLimits: string[];
    categories: PromotionEligibilityEntity[];
    brands: PromotionEligibilityEntity[];
    products: PromotionEligibilityEntity[];
  };
  usageSummary: {
    totalRedemptions: number;
    remainingUses: number | null;
    perUserLimit: number | null;
    totalLimit: number | null;
    isExhausted: boolean;
    exhaustedStateLabel: string | null;
  };
  validation: {
    liveValidityStatus: PromotionValidityStatus;
    warnings: string[];
    checkoutHints: string[];
    invalidConfiguration: boolean;
    invalidReasons: string[];
  };
  linkedBusinessRules: {
    minSubtotal: number | null;
    maxDiscount: number | null;
    excludeDiscountedItems: boolean;
    eligibleCategories: PromotionEligibilityEntity[];
    eligibleBrands: PromotionEligibilityEntity[];
    eligibleProducts: PromotionEligibilityEntity[];
  };
};

export type AdminPromotionsListResponse = {
  items: PromotionListItem[];
  page: number;
  limit: number;
  total: number;
};

export type PromotionUpsertInput = {
  code: string;
  title: string;
  description?: string | null;
  type: PromotionType;
  value: number;
  minSubtotal?: number | null;
  maxDiscount?: number | null;
  usageLimitTotal?: number | null;
  usageLimitPerUser?: number | null;
  startAt: string;
  endAt: string;
  isActive: boolean;
  eligibleCategoryIds: string[];
  eligibleBrandIds: string[];
  eligibleProductIds: string[];
  excludeDiscountedItems: boolean;
};
