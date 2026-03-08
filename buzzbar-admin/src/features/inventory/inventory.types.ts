export type InventoryListItem = {
  variant: {
    _id: string;
    productId: string;
    sku: string;
    volumeMl: number;
    packSize: number;
    price: number;
    isActive: boolean;
  };
  product?: { id: string; name: string; slug: string; isActive: boolean };
  stock: { quantity: number; reserved: number; updatedAt?: string };
  availability: number;
};

export type AdminInventoryListResponse = {
  items: InventoryListItem[];
  page: number;
  limit: number;
  total: number;
};

export type InventoryAdjustResponse = {
  stock: { quantity: number; reserved: number; updatedAt?: string };
  availability: number;
  movement: {
    _id: string;
    variantId: string;
    type: string;
    delta: number;
    reason?: string;
    quantityBefore?: number;
    quantityAfter?: number;
    actorAdminId: string;
    createdAt: string;
  };
};

export type InventoryMovementItem = {
  id: string;
  createdAt: string;
  type: 'RECEIVE' | 'ADJUST' | 'SALE' | 'RETURN';
  delta: number;
  reason?: string;
  quantityBefore?: number;
  quantityAfter?: number;
  actor: { id: string; email: string; role: 'superadmin' | 'admin' | 'employee' };
  variant: { id: string; sku?: string; volumeMl?: number; packSize?: number };
  product: { id: string; name?: string; slug?: string };
};

export type AdminInventoryMovementsResponse = {
  items: InventoryMovementItem[];
  page: number;
  limit: number;
  total: number;
};

