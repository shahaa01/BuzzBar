import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ErrorState } from '../../components/feedback/ErrorState.js';
import { Badge } from '../../components/ui/badge.js';
import { Card } from '../../components/ui/card.js';
import { Skeleton } from '../../components/ui/skeleton.js';
import { normalizeApiError } from '../../lib/api/normalizeError.js';
import { useCapabilities } from '../../lib/permissions/useCapabilities.js';
import { adminGetDashboardSummary } from './dashboard.api.js';

function MetricCard(props: { label: string; value?: number; to?: string; loading?: boolean; note?: string }) {
  const content = (
    <Card className="min-h-[116px] rounded-xl border-white/10 bg-white/[0.03] p-4 shadow-[0_18px_50px_rgba(0,0,0,0.22)] transition-colors">
      <div className="flex h-full flex-col justify-between gap-3">
        <div className="text-xs font-medium tracking-[0.08em] text-muted-foreground">{props.label}</div>
        <div>
          {props.loading ? <Skeleton className="h-8 w-16" /> : <div className="text-2xl font-semibold text-foreground">{typeof props.value === 'number' ? props.value : '—'}</div>}
          {props.note ? <div className="mt-2 text-xs text-muted-foreground">{props.note}</div> : null}
        </div>
      </div>
    </Card>
  );
  if (!props.to) return content;
  return (
    <Link to={props.to} className="block rounded-xl focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background">
      {content}
    </Link>
  );
}

export function DashboardPage() {
  const lowStockThreshold = 5;
  const { can } = useCapabilities();

  const queryKey = useMemo(() => ['admin', 'dashboard', 'summary', { lowStockThreshold }], [lowStockThreshold]);
  const q = useQuery({ queryKey, queryFn: () => adminGetDashboardSummary({ lowStockThreshold }) });

  const data = q.data;
  const counts = data?.counts;

  function minutesToHuman(m?: number) {
    if (typeof m !== 'number') return '—';
    const h = Math.floor(m / 60);
    const min = m % 60;
    if (h <= 0) return `${min}m`;
    return `${h}h ${min}m`;
  }

  return (
    <div className="space-y-4">
      {q.isError ? <ErrorState error={normalizeApiError(q.error)} onRetry={() => q.refetch()} /> : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <MetricCard label="Orders today" value={counts?.ordersToday} to={can('orders') ? '/orders' : undefined} loading={q.isLoading} />
        <MetricCard label="Orders pending review" value={counts?.ordersPendingReview} to={can('orders') ? '/orders?status=KYC_PENDING_REVIEW' : undefined} loading={q.isLoading} />
        <MetricCard label="KYC pending" value={counts?.kycPending} to={can('kyc') ? '/kyc?status=pending' : undefined} loading={q.isLoading} />
        <MetricCard label={`Low stock (≤ ${data?.inventory.lowStockThreshold ?? lowStockThreshold})`} value={counts?.inventoryLowStock} to={can('inventory_edit') ? '/inventory' : undefined} loading={q.isLoading} />
        <MetricCard label="Active promotions" value={counts?.promotionsActive} to={can('promotions_read') ? '/promotions?state=active' : undefined} loading={q.isLoading} />
        <MetricCard label="Wallet pending" value={counts?.walletPending} to={can('payments_read') ? '/payments?status=PENDING&paymentMethod=WALLET' : undefined} loading={q.isLoading} note="Inspect pending wallet flows" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">Order status breakdown (today)</div>
            <div className="text-xs text-muted-foreground">{data ? `as of ${new Date(data.generatedAt).toLocaleString()}` : '—'}</div>
          </div>
          <div className="mt-3 grid gap-2">
            {q.isLoading ? <div className="text-sm text-muted-foreground">Loading…</div> : null}
            {data ? (
              Object.entries(data.statusBreakdown.ordersTodayByStatus)
                .filter(([, v]) => typeof v === 'number' && v > 0)
                .map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                    <div className="font-mono text-xs">{k}</div>
                    <Badge>{v}</Badge>
                  </div>
                ))
            ) : null}
            {data && Object.values(data.statusBreakdown.ordersTodayByStatus).every((v) => !v) ? (
              <div className="text-sm text-muted-foreground">No orders today.</div>
            ) : null}
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="p-4">
            <div className="text-sm font-semibold">KYC snapshot</div>
            <div className="mt-3 grid gap-2 text-sm">
              <div className="flex justify-between gap-3">
                <div className="text-muted-foreground">Pending</div>
                <div className="font-medium">{counts?.kycPending ?? '—'}</div>
              </div>
              <div className="flex justify-between gap-3">
                <div className="text-muted-foreground">Oldest pending wait</div>
                <div>{minutesToHuman(data?.kycOldestPending.waitMinutes)}</div>
              </div>
            </div>
            <div className="mt-3">
              <Link to={can('kyc') ? '/kyc?status=pending' : '/dashboard'} className="text-xs text-muted-foreground underline underline-offset-4">
                Review queue
              </Link>
            </div>
          </Card>

          <Card className="p-4">
            <div className="text-sm font-semibold">Quick actions</div>
            <div className="mt-3 grid gap-2 text-xs text-muted-foreground">
              {can('orders') ? <Link to="/orders" className="underline underline-offset-4">Operate orders</Link> : null}
              {can('inventory_edit') ? <Link to="/inventory" className="underline underline-offset-4">Adjust inventory</Link> : null}
              {can('promotions_read') ? <Link to="/promotions" className="underline underline-offset-4">View promotions</Link> : null}
              {can('settings_read') ? <Link to="/settings" className="underline underline-offset-4">Business settings</Link> : null}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
