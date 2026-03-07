import type { AdminRole } from '../auth/claims.js';

export type Capability =
  | 'dashboard'
  | 'orders'
  | 'kyc'
  | 'inventory'
  | 'payments'
  | 'catalog'
  | 'settings_read'
  | 'settings_write'
  | 'uploads';

export function capabilitiesForRole(role: AdminRole): Set<Capability> {
  if (role === 'employee') {
    return new Set<Capability>(['dashboard', 'orders', 'kyc', 'inventory', 'payments']);
  }
  if (role === 'admin') {
    return new Set<Capability>(['dashboard', 'orders', 'kyc', 'inventory', 'payments', 'catalog', 'uploads', 'settings_read']);
  }
  return new Set<Capability>([
    'dashboard',
    'orders',
    'kyc',
    'inventory',
    'payments',
    'catalog',
    'uploads',
    'settings_read',
    'settings_write'
  ]);
}

export function canRole(role: AdminRole, capability: Capability) {
  return capabilitiesForRole(role).has(capability);
}

