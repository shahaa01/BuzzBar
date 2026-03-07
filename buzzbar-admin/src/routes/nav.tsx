import { LayoutDashboard, Package, ShieldCheck, Boxes, CreditCard, Tags, Settings } from 'lucide-react';
import type { Capability } from '../lib/permissions/capabilities.js';
import type React from 'react';

export type NavItem = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  capability: Capability;
};

// Promotions is intentionally omitted in Phase 2A (backend admin CRUD not present yet).
export const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, capability: 'dashboard' },
  { to: '/orders', label: 'Orders', icon: Package, capability: 'orders' },
  { to: '/kyc', label: 'KYC', icon: ShieldCheck, capability: 'kyc' },
  { to: '/inventory', label: 'Inventory', icon: Boxes, capability: 'inventory' },
  { to: '/payments', label: 'Payments', icon: CreditCard, capability: 'payments' },
  { to: '/catalog', label: 'Catalog', icon: Tags, capability: 'catalog' },
  { to: '/settings', label: 'Settings', icon: Settings, capability: 'settings_read' }
];
