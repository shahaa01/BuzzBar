import { Copy, RefreshCw, Search } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { EmptyState } from '../../components/feedback/EmptyState.js';
import { ErrorState } from '../../components/feedback/ErrorState.js';
import { SavedFiltersBar } from '../../components/feedback/SavedFiltersBar.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card } from '../../components/ui/card.js';
import { Input } from '../../components/ui/input.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select.js';
import { Skeleton } from '../../components/ui/skeleton.js';
import { normalizeApiError } from '../../lib/api/normalizeError.js';
import { useCapabilities } from '../../lib/permissions/useCapabilities.js';
import { adminListPayments } from './payments.api.js';
import type { PaymentListSort, PaymentMethod, PaymentProvider, PaymentTransactionStatus } from './payments.types.js';

const PROVIDERS: Array<PaymentProvider | 'ALL'> = ['ALL', 'MOCK', 'ESEWA', 'KHALTI'];
const STATUSES: Array<PaymentTransactionStatus | 'ALL'> = ['ALL', 'INITIATED', 'PENDING', 'SUCCESS', 'FAILED'];
const METHODS: Array<PaymentMethod | 'ALL'> = ['ALL', 'COD', 'WALLET'];

function fmtMoney(n: number) {
  return `NPR ${Math.trunc(n)}`;
}

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function paymentStatusVariant(status: PaymentTransactionStatus) {
  if (status === 'SUCCESS') return 'success' as const;
  if (status === 'FAILED') return 'destructive' as const;
  if (status === 'PENDING') return 'warning' as const;
  return 'default' as const;
}

async function copy(label: string, value?: string) {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  } catch {
    toast.error('Copy failed');
  }
}

export function PaymentsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { can } = useCapabilities();
  const canOpenOrders = can('orders');

  const provider = (searchParams.get('provider') ?? 'ALL').trim() as PaymentProvider | 'ALL';
  const status = (searchParams.get('status') ?? 'ALL').trim() as PaymentTransactionStatus | 'ALL';
  const paymentMethod = (searchParams.get('paymentMethod') ?? 'ALL').trim() as PaymentMethod | 'ALL';
  const q = (searchParams.get('q') ?? '').trim() || undefined;
  const from = (searchParams.get('from') ?? '').trim() || undefined;
  const to = (searchParams.get('to') ?? '').trim() || undefined;
  const stalePending = searchParams.get('stalePending') === 'true';
  const sort = (searchParams.get('sort') ?? 'createdAt_desc').trim() as PaymentListSort;
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const limitRaw = Number(searchParams.get('limit') ?? '20') || 20;
  const limit = ([20, 50, 100].includes(limitRaw) ? limitRaw : 20) as 20 | 50 | 100;

  function setParam(next: Record<string, string | undefined>) {
    const sp = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(next)) {
      if (!value) sp.delete(key);
      else sp.set(key, value);
    }
    setSearchParams(sp, { replace: true });
  }

  function resetPageAndSet(next: Record<string, string | undefined>) {
    const sp = new URLSearchParams(searchParams);
    sp.set('page', '1');
    for (const [key, value] of Object.entries(next)) {
      if (!value) sp.delete(key);
      else sp.set(key, value);
    }
    setSearchParams(sp, { replace: true });
  }

  const query = useQuery({
    queryKey: ['admin', 'payments', 'list', { provider, status, paymentMethod, q, from, to, stalePending, sort, page, limit }],
    queryFn: () =>
      adminListPayments({
        provider: provider === 'ALL' ? undefined : provider,
        status: status === 'ALL' ? undefined : status,
        paymentMethod: paymentMethod === 'ALL' ? undefined : paymentMethod,
        q,
        from,
        to,
        stalePending: stalePending || undefined,
        sort,
        page,
        limit
      })
  });

  const data = query.data;

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-5">
              <div className="grid gap-1">
                <div className="text-xs text-muted-foreground">Provider</div>
                <Select value={provider} onValueChange={(value) => resetPageAndSet({ provider: value === 'ALL' ? undefined : value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PROVIDERS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option === 'ALL' ? 'All providers' : option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1">
                <div className="text-xs text-muted-foreground">Status</div>
                <Select value={status} onValueChange={(value) => resetPageAndSet({ status: value === 'ALL' ? undefined : value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option === 'ALL' ? 'All statuses' : option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1">
                <div className="text-xs text-muted-foreground">Method</div>
                <Select value={paymentMethod} onValueChange={(value) => resetPageAndSet({ paymentMethod: value === 'ALL' ? undefined : value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {METHODS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option === 'ALL' ? 'All methods' : option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1">
                <div className="text-xs text-muted-foreground">From date</div>
                <Input type="date" value={from ?? ''} onChange={(event) => resetPageAndSet({ from: event.currentTarget.value || undefined })} />
              </div>
              <div className="grid gap-1">
                <div className="text-xs text-muted-foreground">To date</div>
                <Input type="date" value={to ?? ''} onChange={(event) => resetPageAndSet({ to: event.currentTarget.value || undefined })} />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Select value={sort} onValueChange={(value) => resetPageAndSet({ sort: value })}>
                <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="createdAt_desc">Newest first</SelectItem>
                  <SelectItem value="createdAt_asc">Oldest first</SelectItem>
                  <SelectItem value="amount_desc">Amount high to low</SelectItem>
                  <SelectItem value="amount_asc">Amount low to high</SelectItem>
                  <SelectItem value="updatedAt_desc">Updated recently</SelectItem>
                </SelectContent>
              </Select>
              <Select value={String(limit)} onValueChange={(value) => resetPageAndSet({ limit: value })}>
                <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="20">20 / page</SelectItem>
                  <SelectItem value="50">50 / page</SelectItem>
                  <SelectItem value="100">100 / page</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="secondary" onClick={() => query.refetch()} disabled={query.isFetching}>
                <RefreshCw className={`mr-2 h-4 w-4 ${query.isFetching ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              <Button variant="secondary" onClick={() => setSearchParams(new URLSearchParams(), { replace: true })}>
                Reset
              </Button>
            </div>
          </div>

          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_220px]">
            <div className="grid gap-1">
              <div className="text-xs text-muted-foreground">Transaction / order / user search</div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  key={q ?? 'payment-q'}
                  className="pl-9"
                  placeholder="Transaction id, provider ref, order number, user email"
                  defaultValue={q ?? ''}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      const value = event.currentTarget.value.trim();
                      resetPageAndSet({ q: value || undefined });
                    }
                  }}
                />
              </div>
            </div>
            <div className="flex items-end">
              <Button variant={stalePending ? 'default' : 'secondary'} className="w-full" onClick={() => resetPageAndSet({ stalePending: stalePending ? undefined : 'true' })}>
                {stalePending ? 'Showing stale pending' : 'Filter stale pending'}
              </Button>
            </div>
          </div>

          <SavedFiltersBar
            moduleKey="payments"
            currentParams={searchParams}
            paginationKeys={['page']}
            onApply={(params) => setSearchParams(params, { replace: false })}
          />
        </div>
      </Card>

      {query.isError ? <ErrorState error={normalizeApiError(query.error)} onRetry={() => query.refetch()} /> : null}

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <div className="text-sm font-semibold">Payments</div>
            <div className="mt-1 text-xs text-muted-foreground">Operational payment inspection with order and user context.</div>
          </div>
          <div className="text-xs text-muted-foreground">{data ? `Page ${data.page} · ${data.total} total` : 'Loading…'}</div>
        </div>

        {!query.isLoading && data?.items?.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No payments match these filters"
              description="Reset filters or broaden the provider, date, and search constraints."
              actionLabel="Reset filters"
              onAction={() => setSearchParams(new URLSearchParams(), { replace: true })}
            />
          </div>
        ) : null}

        {data?.items?.length || query.isLoading ? (
          <div className="max-h-[72vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-muted/95 text-left text-xs text-muted-foreground backdrop-blur">
                <tr>
                  <th className="px-4 py-3 font-medium">Transaction</th>
                  <th className="px-4 py-3 font-medium">Order</th>
                  <th className="px-4 py-3 font-medium">User</th>
                  <th className="px-4 py-3 font-medium">Provider</th>
                  <th className="px-4 py-3 font-medium">State</th>
                  <th className="px-4 py-3 font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {query.isLoading
                  ? Array.from({ length: 6 }).map((_, index) => (
                      <tr key={`payment-skeleton-${index}`} className="border-t">
                        <td className="px-4 py-3" colSpan={8}>
                          <div className="grid gap-2 md:grid-cols-6">
                            <Skeleton className="h-5 w-full" />
                            <Skeleton className="h-5 w-full" />
                            <Skeleton className="h-5 w-full" />
                            <Skeleton className="h-5 w-full" />
                            <Skeleton className="h-5 w-full" />
                            <Skeleton className="h-5 w-full" />
                          </div>
                        </td>
                      </tr>
                    ))
                  : null}

                {data?.items?.map((item) => (
                  <tr key={item._id} className="border-t align-top">
                    <td className="px-4 py-3">
                      <div className="font-mono text-xs text-foreground">{item._id}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{item.providerReference ?? 'No provider ref'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{item.order?.orderNumber ?? '—'}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{item.order?.status ?? 'No order state'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{item.user?.name ?? item.user?.email ?? 'Unknown user'}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{item.user?.email ?? item.user?.phone ?? '—'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <Badge>{item.provider}</Badge>
                        <Badge>{item.paymentMethod}</Badge>
                        <Badge variant={item.isMock ? 'warning' : 'default'}>{item.isMock ? 'MOCK' : 'LIVE'}</Badge>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={paymentStatusVariant(item.status)}>{item.status}</Badge>
                        <Badge variant={item.finality === 'FINAL' ? 'success' : 'default'}>{item.finality}</Badge>
                        {item.stalePending ? <Badge variant="warning">STALE</Badge> : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-medium">{fmtMoney(item.amount)}</td>
                    <td className="px-4 py-3">
                      <div>{fmtDate(item.createdAt)}</div>
                      <div className="mt-1 text-xs text-muted-foreground">Updated {fmtDate(item.updatedAt)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button size="sm" variant="secondary" asChild>
                          <Link to={`/payments/${item._id}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`}>Open</Link>
                        </Button>
                        {item.order?.id && canOpenOrders ? (
                          <Button size="sm" variant="ghost" asChild>
                            <Link to={`/orders/${item.order.id}`}>Order</Link>
                          </Button>
                        ) : null}
                        <Button size="sm" variant="ghost" onClick={() => copy('Transaction ID', item._id)}>
                          <Copy className="mr-2 h-4 w-4" />
                          Tx
                        </Button>
                        {item.providerReference ? (
                          <Button size="sm" variant="ghost" onClick={() => copy('Provider reference', item.providerReference)}>
                            <Copy className="mr-2 h-4 w-4" />
                            Ref
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <div className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground">
          <div>{data ? `Showing ${(data.page - 1) * data.limit + 1}-${Math.min(data.page * data.limit, data.total)} of ${data.total}` : '—'}</div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" disabled={page <= 1 || query.isFetching} onClick={() => setParam({ page: String(page - 1) })}>
              Prev
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={query.isFetching || !data || data.page * data.limit >= data.total}
              onClick={() => setParam({ page: String(page + 1) })}
            >
              Next
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
