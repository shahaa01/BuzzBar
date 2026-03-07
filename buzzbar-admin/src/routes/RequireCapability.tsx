import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../features/auth/auth.store.js';
import type { Capability } from '../lib/permissions/capabilities.js';
import { canRole } from '../lib/permissions/capabilities.js';
import type React from 'react';

export function RequireCapability(props: { capability: Capability; children: React.ReactNode }) {
  const claims = useAuthStore((s) => s.claims);
  const role = claims?.role;

  if (!role) return <Navigate to="/login" replace />;
  if (!canRole(role, props.capability)) return <Navigate to="/unauthorized" replace />;
  return <>{props.children}</>;
}
