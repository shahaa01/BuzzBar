import { Navigate } from 'react-router-dom';
import type { Capability } from '../lib/permissions/capabilities.js';
import { useCapabilities } from '../lib/permissions/useCapabilities.js';
import type React from 'react';

type Props =
  | { capability: Capability; children: React.ReactNode }
  | { anyOf: Capability[]; children: React.ReactNode };

export function RequireCapability(props: Props) {
  const { role, canAny } = useCapabilities();
  if (!role) return <Navigate to="/login" replace />;
  const caps = 'capability' in props ? [props.capability] : props.anyOf;
  if (!canAny(caps)) return <Navigate to="/unauthorized" replace />;
  return <>{props.children}</>;
}
