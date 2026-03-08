import type { AdminRole } from '../auth/claims.js';

export type Capability =
  | 'orders'
  | 'orders_transition'
  | 'orders_assign'
  | 'kyc'
  | 'inventory_edit'
  | 'promotions_read'
  | 'promotions_manage'
  | 'catalog_products_read'
  | 'dashboard'
  | 'payments_read'
  | 'catalog'
  | 'uploads'
  | 'settings_read'
  | 'settings_write'
  | 'inventory_history';

export const ROLE_CAPABILITY_MATRIX: Record<AdminRole, Capability[]> = {
  employee: ['orders', 'orders_transition', 'kyc', 'inventory_edit', 'promotions_read', 'catalog_products_read'],
  admin: [
    'orders',
    'orders_transition',
    'orders_assign',
    'kyc',
    'inventory_edit',
    'promotions_read',
    'promotions_manage',
    'dashboard',
    'payments_read',
    'catalog',
    'uploads',
    'settings_read',
    'inventory_history'
  ],
  superadmin: [
    'orders',
    'orders_transition',
    'orders_assign',
    'kyc',
    'inventory_edit',
    'promotions_read',
    'promotions_manage',
    'dashboard',
    'payments_read',
    'catalog',
    'uploads',
    'settings_read',
    'settings_write',
    'inventory_history'
  ]
};

export function capabilitiesForRole(role: AdminRole): Set<Capability> {
  return new Set<Capability>(ROLE_CAPABILITY_MATRIX[role]);
}

export function canRole(role: AdminRole, capability: Capability) {
  return capabilitiesForRole(role).has(capability);
}
