import { Navigate } from 'react-router-dom';
import { useCapabilities } from '../lib/permissions/useCapabilities.js';

export function HomeRedirect() {
  const { role, can } = useCapabilities();
  if (!role) return <Navigate to="/login" replace />;
  const to = can('dashboard') ? '/dashboard' : '/orders';
  return <Navigate to={to} replace />;
}
