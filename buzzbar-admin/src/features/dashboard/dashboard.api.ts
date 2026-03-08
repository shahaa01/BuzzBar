import { api } from '../../lib/api/client.js';
import type { AdminDashboardSummary } from './dashboard.types.js';

export async function adminGetDashboardSummary(opts: { lowStockThreshold: number }) {
  const res = await api.get('/api/v1/admin/dashboard/summary', { params: { lowStockThreshold: opts.lowStockThreshold } });
  return res.data?.data as AdminDashboardSummary;
}

