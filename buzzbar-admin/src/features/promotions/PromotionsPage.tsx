import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Loader2, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { EmptyState } from '../../components/feedback/EmptyState.js';
import { ErrorState } from '../../components/feedback/ErrorState.js';
import { SavedFiltersBar } from '../../components/feedback/SavedFiltersBar.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card } from '../../components/ui/card.js';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog.js';
import { Input } from '../../components/ui/input.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select.js';
import { Skeleton } from '../../components/ui/skeleton.js';
import { normalizeApiError, type ApiErrorShape } from '../../lib/api/normalizeError.js';
import { useCapabilities } from '../../lib/permissions/useCapabilities.js';
import { adminDeactivatePromotion, adminListPromotions } from './promotions.api.js';
import type { PromotionListItem, PromotionSort, PromotionStatus, PromotionType } from './promotions.types.js';

const STATUS_FILTERS: Array<PromotionStatus | 'all'> = ['all', 'live', 'scheduled', 'expired', 'inactive'];
const TYPE_FILTERS: Array<PromotionType | 'all'> = ['all', 'PERCENT', 'FLAT'];
const ACTIVE_FILTERS: Array<'all' | 'active' | 'inactive'> = ['all', 'active', 'inactive'];

function statusBadgeVariant(status: PromotionStatus) {
  if (status === 'live') return 'success' as const;
  if (status === 'inactive') return 'destructive' as const;
  if (status === 'expired') return 'warning' as const;
  return 'default' as const;
}

function formatMoney(value: number) {
  return `NPR ${Math.trunc(value)}`;
}

function formatDate(value: string) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

async function copyText(label: string, value: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  } catch {
    toast.error('Copy failed');
  }
}

function tableSkeletonRows() {
  return Array.from({ length: 6 }).map((_, index) => (
    <tr key={`promotion-skeleton-${index}`} className="border-t">
      <td className="px-4 py-3" colSpan={9}>
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
  ));
}

export function PromotionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { can } = useCapabilities();
  const canManage = can('promotions_manage');

  const q = (searchParams.get('q') ?? '').trim() || undefined;
  const type = (searchParams.get('type') ?? 'all').trim() as PromotionType | 'all';
  const isActive = (searchParams.get('isActive') ?? 'all').trim() as 'all' | 'active' | 'inactive';
  const state = (searchParams.get('state') ?? 'all').trim() as PromotionStatus | 'all';
  const from = (searchParams.get('from') ?? '').trim() || undefined;
  const to = (searchParams.get('to') ?? '').trim() || undefined;
  const sort = (searchParams.get('sort') ?? 'createdAt_desc').trim() as PromotionSort;
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const limitRaw = Number(searchParams.get('limit') ?? '20') || 20;
  const limit = ([20, 50, 100].includes(limitRaw) ? limitRaw : 20) as 20 | 50 | 100;

  const [deactivateDialog, setDeactivateDialog] = useState<PromotionListItem | null>(null);
  const [actionError, setActionError] = useState<ApiErrorShape | null>(null);

  function setParams(next: Record<string, string | undefined>, opts?: { resetPage?: boolean }) {
    const sp = new URLSearchParams(searchParams);
    if (opts?.resetPage) sp.set('page', '1');
    for (const [key, value] of Object.entries(next)) {
      if (!value) sp.delete(key);
      else sp.set(key, value);
    }
    setSearchParams(sp, { replace: true });
  }

  const listQuery = useQuery({
    queryKey: ['admin', 'promotions', 'list', { q, type, isActive, state, from, to, sort, page, limit }],
    queryFn: () => adminListPromotions({ q, type, isActive, state, from, to, sort, page, limit })
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => adminDeactivatePromotion(id),
    onMutate: () => setActionError(null),
    onSuccess: async () => {
      toast.success('Promotion deactivated');
      setDeactivateDialog(null);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'promotions'] });
    },
    onError: (error) => setActionError(normalizeApiError(error))
  });

  const data = listQuery.data;

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
          <div className="grid min-w-0 gap-2 md:grid-cols-2 xl:grid-cols-5">
            <div className="grid min-w-0 gap-1">
              <div className="text-xs text-muted-foreground">Search</div>
              <Input
                key={q ?? 'promo-q'}
                placeholder="Code or title"
                defaultValue={q ?? ''}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    const value = event.currentTarget.value.trim();
                    setParams({ q: value || undefined }, { resetPage: true });
                  }
                }}
              />
            </div>

            <div className="grid min-w-0 gap-1">
              <div className="text-xs text-muted-foreground">Status</div>
              <Select value={state} onValueChange={(value) => setParams({ state: value === 'all' ? undefined : value }, { resetPage: true })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_FILTERS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option === 'all' ? 'All statuses' : option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid min-w-0 gap-1">
              <div className="text-xs text-muted-foreground">Promo type</div>
              <Select value={type} onValueChange={(value) => setParams({ type: value === 'all' ? undefined : value }, { resetPage: true })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TYPE_FILTERS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option === 'all' ? 'All types' : option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid min-w-0 gap-1">
              <div className="text-xs text-muted-foreground">Active state</div>
              <Select value={isActive} onValueChange={(value) => setParams({ isActive: value === 'all' ? undefined : value }, { resetPage: true })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACTIVE_FILTERS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option === 'all' ? 'All' : option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid min-w-0 gap-1">
              <div className="text-xs text-muted-foreground">Sort</div>
              <Select value={sort} onValueChange={(value) => setParams({ sort: value }, { resetPage: true })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="createdAt_desc">Newest first</SelectItem>
                  <SelectItem value="createdAt_asc">Oldest first</SelectItem>
                  <SelectItem value="updatedAt_desc">Updated recently</SelectItem>
                  <SelectItem value="startsAt_asc">Starts soonest</SelectItem>
                  <SelectItem value="endsAt_asc">Ends soonest</SelectItem>
                  <SelectItem value="usageCount_desc">Highest usage</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2">
            {canManage ? (
              <Button asChild>
                <Link to={`/promotions/new${location.search ? `?${location.search.slice(1)}` : ''}`}>New promotion</Link>
              </Button>
            ) : null}
            <Button variant="secondary" onClick={() => listQuery.refetch()} disabled={listQuery.isFetching}>
              <RefreshCw className={`mr-2 h-4 w-4 ${listQuery.isFetching ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button variant="secondary" onClick={() => setSearchParams(new URLSearchParams(), { replace: true })}>
              Reset
            </Button>
          </div>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-[minmax(180px,0.9fr)_minmax(180px,0.9fr)_auto]">
          <div className="grid min-w-0 gap-1">
            <div className="text-xs text-muted-foreground">From date</div>
            <Input type="date" value={from ?? ''} onChange={(event) => setParams({ from: event.currentTarget.value || undefined }, { resetPage: true })} />
          </div>
          <div className="grid min-w-0 gap-1">
            <div className="text-xs text-muted-foreground">To date</div>
            <Input type="date" value={to ?? ''} onChange={(event) => setParams({ to: event.currentTarget.value || undefined }, { resetPage: true })} />
          </div>
        </div>

        <div className="mt-3">
          <SavedFiltersBar
            moduleKey="promotions"
            currentParams={searchParams}
            paginationKeys={['page']}
            onApply={(params) => setSearchParams(params, { replace: false })}
          />
        </div>
      </Card>

      {listQuery.isError ? <ErrorState error={normalizeApiError(listQuery.error)} onRetry={() => listQuery.refetch()} /> : null}
      {actionError ? <ErrorState error={actionError} onRetry={() => listQuery.refetch()} /> : null}

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <div className="text-sm font-semibold">Promotions</div>
            <div className="mt-1 text-xs text-muted-foreground">Search, inspect, and deactivate promotions without leaving the operational flow.</div>
          </div>
          <div className="rounded-full border border-border/70 bg-muted/50 px-3 py-1 text-xs text-muted-foreground">
            {data ? `Page ${data.page} · ${data.total} total` : 'Loading…'}
          </div>
        </div>

        {!listQuery.isLoading && data?.items?.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No promotions match these filters"
              description="Broaden the search or clear status and date filters to inspect more promotions."
              actionLabel="Reset filters"
              onAction={() => setSearchParams(new URLSearchParams(), { replace: true })}
            />
          </div>
        ) : null}

        {data?.items?.length || listQuery.isLoading ? (
          <div className="max-h-[72vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-muted/95 text-left text-xs text-muted-foreground backdrop-blur">
                <tr>
                  <th className="px-4 py-3 font-medium">Promo</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Window</th>
                  <th className="px-4 py-3 font-medium">Usage</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 font-medium">Updated</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {listQuery.isLoading ? tableSkeletonRows() : null}

                {data?.items?.map((promotion) => {
                  const detailHref = `/promotions/${promotion.id}${location.search ? `?${location.search.slice(1)}` : ''}`;
                  return (
                    <tr key={promotion.id} className="border-t align-top">
                      <td className="px-4 py-3">
                        <div className="font-medium">{promotion.code}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{promotion.title ?? 'No title yet'}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{promotion.type === 'PERCENT' ? `${promotion.value}%` : formatMoney(promotion.value)}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{promotion.type}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <Badge variant={statusBadgeVariant(promotion.status)}>{promotion.status}</Badge>
                          {promotion.isExhausted ? <Badge variant="warning">EXHAUSTED</Badge> : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        <div>{formatDate(promotion.startAt)}</div>
                        <div className="mt-1">to {formatDate(promotion.endAt)}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{promotion.usageCount}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {typeof promotion.usageLimitTotal === 'number' ? `of ${promotion.usageLimitTotal}` : 'No total cap'}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{formatDate(promotion.createdAt)}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{formatDate(promotion.updatedAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button asChild size="sm" variant="secondary">
                            <Link to={detailHref}>{canManage ? 'View / Edit' : 'View'}</Link>
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => copyText('Promo code', promotion.code)}>
                            <Copy className="mr-2 h-4 w-4" />
                            Copy
                          </Button>
                          {canManage && promotion.isActive ? (
                            <Button size="sm" variant="destructive" onClick={() => setDeactivateDialog(promotion)}>
                              Deactivate
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-xs text-muted-foreground">
          <div>{data ? `Showing ${(data.page - 1) * data.limit + 1}-${Math.min(data.page * data.limit, data.total)} of ${data.total}` : '—'}</div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={String(limit)} onValueChange={(value) => setParams({ limit: value }, { resetPage: true })}>
              <SelectTrigger className="h-8 w-[120px] bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="20">20 / page</SelectItem>
                <SelectItem value="50">50 / page</SelectItem>
                <SelectItem value="100">100 / page</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="secondary" size="sm" disabled={page <= 1 || listQuery.isFetching} onClick={() => setParams({ page: String(page - 1) })}>
              Prev
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={listQuery.isFetching || !data || data.page * data.limit >= data.total}
              onClick={() => setParams({ page: String(page + 1) })}
            >
              Next
            </Button>
          </div>
        </div>
      </Card>

      <Dialog open={Boolean(deactivateDialog)} onOpenChange={(open) => !open && setDeactivateDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deactivate this promotion?</DialogTitle>
            <DialogDescription>
              {deactivateDialog ? `${deactivateDialog.code} will stop applying to future validations and orders.` : 'This promotion will be deactivated.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeactivateDialog(null)}>
              Keep active
            </Button>
            <Button variant="destructive" disabled={!deactivateDialog || deactivateMutation.isPending} onClick={() => deactivateDialog && deactivateMutation.mutate(deactivateDialog.id)}>
              {deactivateMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Deactivate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
