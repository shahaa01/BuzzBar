import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Clock3, Copy, ExternalLink, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ErrorState } from '../../components/feedback/ErrorState.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card } from '../../components/ui/card.js';
import { Skeleton } from '../../components/ui/skeleton.js';
import { normalizeApiError } from '../../lib/api/normalizeError.js';
import { useCapabilities } from '../../lib/permissions/useCapabilities.js';
import { adminGetPaymentTransaction } from './payments.api.js';
import { PayloadCard } from './PayloadCard.js';
import type { PaymentTransactionStatus } from './payments.types.js';

function fmtMoney(n: number) {
  return `NPR ${Math.trunc(n)}`;
}

function fmtDate(iso?: string) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function statusVariant(status: PaymentTransactionStatus) {
  if (status === 'SUCCESS') return 'success' as const;
  if (status === 'FAILED') return 'destructive' as const;
  if (status === 'PENDING') return 'warning' as const;
  return 'default' as const;
}

function DetailRow(props: { label: string; value: ReactNode; copyValue?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{props.label}</div>
      <div className="flex items-center gap-2 text-right text-sm text-foreground">
        <span>{props.value}</span>
        {props.copyValue ? <CopyButton label={props.label} value={props.copyValue} /> : null}
      </div>
    </div>
  );
}

function CopyButton(props: { label: string; value: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(props.value);
          toast.success(`${props.label} copied`);
        } catch {
          toast.error('Copy failed');
        }
      }}
    >
      <Copy className="h-3.5 w-3.5" />
    </Button>
  );
}

function SectionCard(props: { title: string; subtitle?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <Card className="border-white/10 bg-white/[0.03] p-5 shadow-[0_18px_60px_rgba(0,0,0,0.25)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold tracking-wide text-foreground">{props.title}</div>
          {props.subtitle ? <div className="mt-1 text-xs text-muted-foreground">{props.subtitle}</div> : null}
        </div>
        {props.actions}
      </div>
      <div className="mt-4">{props.children}</div>
    </Card>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-4">
      <Card className="p-6">
        <div className="grid gap-4">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-80" />
          <div className="flex gap-2">
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-6 w-20" />
          </div>
        </div>
      </Card>
      <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
      <Skeleton className="h-72 w-full" />
    </div>
  );
}

export function PaymentDetailPage() {
  const params = useParams();
  const id = String(params.id ?? '');
  const location = useLocation();
  const { can } = useCapabilities();
  const canOpenOrders = can('orders');

  const query = useQuery({
    queryKey: ['admin', 'payments', 'detail', id],
    queryFn: () => adminGetPaymentTransaction(id),
    enabled: Boolean(id)
  });

  const data = query.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" asChild>
            <Link to={`/payments${location.search}`}>Back</Link>
          </Button>
          <div>
            <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Payment Transaction</div>
            <div className="mt-1 text-lg font-semibold text-foreground">{data?.payment.id ?? 'Loading transaction'}</div>
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={() => query.refetch()} disabled={query.isFetching}>
          <RefreshCw className={`mr-2 h-4 w-4 ${query.isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {query.isError ? <ErrorState error={normalizeApiError(query.error)} onRetry={() => query.refetch()} /> : null}
      {query.isLoading ? <DetailSkeleton /> : null}

      {data ? (
        <>
          <Card className="overflow-hidden border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(120,164,220,0.18),transparent_34%),linear-gradient(135deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-6 shadow-[0_22px_80px_rgba(0,0,0,0.35)]">
            <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Badge variant={statusVariant(data.payment.status)}>{data.payment.status}</Badge>
                  <Badge>{data.payment.provider}</Badge>
                  <Badge>{data.payment.paymentMethod}</Badge>
                  <Badge variant={data.payment.isMock ? 'warning' : 'default'}>{data.payment.isMock ? 'MOCK' : 'LIVE'}</Badge>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Transaction ID</div>
                  <div className="mt-1 flex items-center gap-2 text-2xl font-semibold text-foreground">
                    <span className="font-mono text-xl">{data.payment.id}</span>
                    <CopyButton label="Transaction ID" value={data.payment.id} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {data.diagnostics.stalePending ? <div className="rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs text-amber-100">STALE PENDING</div> : null}
                  {data.diagnostics.pendingAgeMinutes !== undefined ? <div className="rounded-full border border-white/10 px-3 py-1 text-xs text-muted-foreground">{data.diagnostics.pendingAgeMinutes} min old</div> : null}
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <Card className="border-white/10 bg-black/20 p-4">
                  <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Amount</div>
                  <div className="mt-2 text-2xl font-semibold text-foreground">{fmtMoney(data.payment.amount)}</div>
                </Card>
                <Card className="border-white/10 bg-black/20 p-4">
                  <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Updated</div>
                  <div className="mt-2 text-sm text-foreground">{fmtDate(data.payment.updatedAt)}</div>
                </Card>
              </div>
            </div>
          </Card>

          <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
            <div className="space-y-4">
              <SectionCard title="Core Summary" subtitle="Readable transaction summary with linked commercial context.">
                <div className="divide-y divide-white/10">
                  <DetailRow label="Transaction ID" value={data.payment.id} copyValue={data.payment.id} />
                  <DetailRow label="Provider" value={data.payment.provider} />
                  <DetailRow label="Provider Reference" value={data.payment.providerReference ?? '—'} copyValue={data.payment.providerReference} />
                  <DetailRow label="Payment Method" value={data.payment.paymentMethod} />
                  <DetailRow label="Status" value={data.payment.status} />
                  <DetailRow label="Amount" value={`${fmtMoney(data.payment.amount)} ${data.payment.currency}`} />
                  <DetailRow label="Created At" value={fmtDate(data.payment.createdAt)} />
                  <DetailRow label="Updated At" value={fmtDate(data.payment.updatedAt)} />
                </div>
              </SectionCard>

              <div className="grid gap-4 xl:grid-cols-2">
                <PayloadCard title="Request Snapshot" subtitle="Normalized request payload for the transaction." payload={data.snapshots.request} />
                <PayloadCard title="Response Snapshot" subtitle="Normalized provider response payload." payload={data.snapshots.response} />
              </div>

              <SectionCard title="Failure / Diagnostics" subtitle="Operator-facing interpretation of the current payment state.">
                <div className="space-y-4">
                  {data.diagnostics.operatorHint ? (
                    <div className={`rounded-xl border p-4 text-sm ${data.payment.status === 'FAILED' ? 'border-rose-500/20 bg-rose-500/10 text-rose-100' : 'border-amber-500/20 bg-amber-500/10 text-amber-100'}`}>
                      <div className="flex items-start gap-2">
                        {data.payment.status === 'FAILED' ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <Clock3 className="mt-0.5 h-4 w-4 shrink-0" />}
                        <span>{data.diagnostics.operatorHint}</span>
                      </div>
                    </div>
                  ) : null}
                  <div className="divide-y divide-white/10">
                    <DetailRow label="Failure Reason" value={data.diagnostics.failureReason ?? '—'} />
                    <DetailRow label="Request ID" value={data.diagnostics.requestId ?? '—'} copyValue={data.diagnostics.requestId} />
                    <DetailRow label="Provider Result" value={data.diagnostics.providerResult ?? '—'} />
                    <DetailRow label="Stale Pending" value={data.diagnostics.stalePending ? 'Yes' : 'No'} />
                    <DetailRow label="Pending Age" value={data.diagnostics.pendingAgeMinutes !== undefined ? `${data.diagnostics.pendingAgeMinutes} minutes` : '—'} />
                  </div>
                </div>
              </SectionCard>
            </div>

            <div className="space-y-4">
              <SectionCard title="Associated Order" subtitle="Commercial context for this transaction.">
                <div className="divide-y divide-white/10">
                  <DetailRow label="Order Number" value={data.order?.orderNumber ?? '—'} />
                  <DetailRow label="Order Status" value={data.order?.status ?? '—'} />
                  <DetailRow label="Payment Snapshot" value={data.order?.paymentStatus ?? '—'} />
                  <DetailRow label="Order Total" value={data.order ? fmtMoney(data.order.total) : '—'} />
                </div>
                {data.order?.id && canOpenOrders ? (
                  <div className="mt-4">
                    <Button asChild variant="secondary">
                      <Link to={`/orders/${data.order.id}`}>
                        Open linked order
                        <ExternalLink className="ml-2 h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                ) : null}
              </SectionCard>

              <SectionCard title="Associated User" subtitle="User identity snapshot tied to this transaction.">
                <div className="divide-y divide-white/10">
                  <DetailRow label="User ID" value={data.user?.id ?? '—'} copyValue={data.user?.id} />
                  <DetailRow label="Name" value={data.user?.name ?? '—'} />
                  <DetailRow label="Email" value={data.user?.email ?? '—'} copyValue={data.user?.email} />
                  <DetailRow label="Phone" value={data.user?.phone ?? '—'} copyValue={data.user?.phone} />
                </div>
              </SectionCard>

              <SectionCard title="Audit / Timing" subtitle="Timing and lifecycle summary for the current state.">
                <div className="divide-y divide-white/10">
                  <DetailRow label="Created At" value={fmtDate(data.payment.createdAt)} />
                  <DetailRow label="Updated At" value={fmtDate(data.payment.updatedAt)} />
                  <DetailRow label="Finality" value={data.payment.isFinal ? 'Final' : 'Open'} />
                  <DetailRow label="Mock / Live" value={data.payment.isMock ? 'Mock' : 'Live'} />
                </div>
              </SectionCard>

              {data.payment.isMock && data.diagnostics.mockLifecycle ? (
                <SectionCard title="Mock Wallet Lifecycle" subtitle="QA-friendly timeline for mock provider behavior.">
                  <div className="space-y-3">
                    {data.diagnostics.mockLifecycle.steps.map((step) => (
                      <div key={step.id} className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium text-foreground">{step.label}</div>
                            <div className="mt-1 text-xs text-muted-foreground">{fmtDate(step.at)}</div>
                          </div>
                          <Badge variant={step.state === 'failed' ? 'destructive' : step.state === 'pending' ? 'warning' : 'success'}>{step.state.toUpperCase()}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </SectionCard>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
