import { useMemo } from 'react';
import { useAuthStore } from '../../features/auth/auth.store.js';
import { capabilitiesForRole, type Capability } from './capabilities.js';

export function useCapabilities() {
  const claims = useAuthStore((state) => state.claims);
  const role = claims?.role;

  const capabilities = useMemo(() => (role ? capabilitiesForRole(role) : new Set<Capability>()), [role]);

  return {
    role,
    capabilities,
    can: (capability: Capability) => capabilities.has(capability),
    canAny: (required: Capability[]) => required.some((capability) => capabilities.has(capability))
  };
}
