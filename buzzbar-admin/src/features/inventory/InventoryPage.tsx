import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useSearchParams } from 'react-router-dom';
import { ErrorState } from '../../components/feedback/ErrorState.js';
import { SavedFiltersBar } from '../../components/feedback/SavedFiltersBar.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card } from '../../components/ui/card.js';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog.js';
import { Input } from '../../components/ui/input.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select.js';
import { Textarea } from '../../components/ui/textarea.js';
import { normalizeApiError } from '../../lib/api/normalizeError.js';
import { useCapabilities } from '../../lib/permissions/useCapabilities.js';
import { adminAdjustInventory, adminListInventory, adminListInventoryMovements } from './inventory.api.js';
import type { InventoryListItem } from './inventory.types.js';

export function InventoryPage() {
  const { can } = useCapabilities();
  const canSeeHistory = can('inventory_history');

  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (searchParams.get('tab') ?? 'stock') as 'stock' | 'history';

  const qc = useQueryClient();

  const stockPage = Math.max(1, Number(searchParams.get('s_page') ?? '1') || 1);
  const stockLimitRaw = Number(searchParams.get('s_limit') ?? '50') || 50;
  const stockLimit = [50, 100].includes(stockLimitRaw) ? stockLimitRaw : 50;
  const stockProductId = (searchParams.get('productId') ?? '').trim() || undefined;

  const histPage = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const histLimitRaw = Number(searchParams.get('limit') ?? '20') || 20;
  const histLimit = [20, 50, 100].includes(histLimitRaw) ? histLimitRaw : 20;
  const histQ = (searchParams.get('q') ?? '').trim() || undefined;
  const histActor = (searchParams.get('actor') ?? '').trim() || undefined;
  const histTypeParam = (searchParams.get('type') ?? '').trim();
  const histType: 'RECEIVE' | 'ADJUST' | 'SALE' | 'RETURN' | undefined =
    histTypeParam === 'RECEIVE' || histTypeParam === 'ADJUST' || histTypeParam === 'SALE' || histTypeParam === 'RETURN'
      ? histTypeParam
      : undefined;
  const histFrom = (searchParams.get('from') ?? '').trim() || undefined; // YYYY-MM-DD
  const histTo = (searchParams.get('to') ?? '').trim() || undefined; // YYYY-MM-DD

  const tz = 'Asia/Kathmandu';
  const fromIso = histFrom ? DateTime.fromISO(histFrom, { zone: tz }).startOf('day').toUTC().toISO() ?? undefined : undefined;
  const toIso = histTo ? DateTime.fromISO(histTo, { zone: tz }).plus({ days: 1 }).startOf('day').toUTC().toISO() ?? undefined : undefined;

  function setParams(next: Record<string, string | undefined>, opts?: { resetPage?: boolean }) {
    const sp = new URLSearchParams(searchParams);
    if (opts?.resetPage) sp.set('page', '1');
    for (const [k, v] of Object.entries(next)) {
      if (!v) sp.delete(k);
      else sp.set(k, v);
    }
    setSearchParams(sp, { replace: true });
  }

  function setStockParams(next: Record<string, string | undefined>, opts?: { resetPage?: boolean }) {
    const sp = new URLSearchParams(searchParams);
    if (opts?.resetPage) sp.set('s_page', '1');
    for (const [k, v] of Object.entries(next)) {
      if (!v) sp.delete(k);
      else sp.set(k, v);
    }
    setSearchParams(sp, { replace: true });
  }

  const inventoryQuery = useQuery({
    queryKey: useMemo(() => ['admin', 'inventory', 'list', { stockPage, stockLimit, stockProductId }], [stockPage, stockLimit, stockProductId]),
    queryFn: () => adminListInventory({ page: stockPage, limit: stockLimit, productId: stockProductId }),
    enabled: tab === 'stock'
  });

  const movementsQuery = useQuery({
    queryKey: useMemo(
      () => ['admin', 'inventory', 'movements', { histQ, histActor, histType, fromIso, toIso, histPage, histLimit }],
      [histQ, histActor, histType, fromIso, toIso, histPage, histLimit]
    ),
    queryFn: () =>
      adminListInventoryMovements({
        q: histQ,
        actor: histActor,
        type: histType,
        from: fromIso,
        to: toIso,
        page: histPage,
        limit: histLimit
      }),
    enabled: tab === 'history' && canSeeHistory
  });

  const [adjustOpen, setAdjustOpen] = useState(false);
  const [selected, setSelected] = useState<InventoryListItem | null>(null);
  const [deltaStr, setDeltaStr] = useState('');
  const [reason, setReason] = useState('');

  const adjustMutation = useMutation({
    mutationFn: (opts: { variantId: string; delta: number; reason: string }) => adminAdjustInventory(opts),
    onSuccess: async () => {
      toast.success('Inventory adjusted');
      setAdjustOpen(false);
      setSelected(null);
      setDeltaStr('');
      setReason('');
      await qc.invalidateQueries({ queryKey: ['admin', 'inventory', 'list'] });
      await qc.invalidateQueries({ queryKey: ['admin', 'inventory', 'movements'] });
    },
    onError: (err) => {
      const e = normalizeApiError(err);
      toast.error(e.errorCode ? `${e.errorCode}: ${e.message}` : e.message);
    }
  });

  function fmtDate(iso: string) {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }

  function stockRow(it: InventoryListItem) {
    const qty = Number(it.stock?.quantity ?? 0);
    const reserved = Number(it.stock?.reserved ?? 0);
    const available = Number(it.availability ?? Math.max(qty - reserved, 0));
    return { qty, reserved, available };
  }

  function resetCurrentTab() {
    if (tab === 'history') {
      setSearchParams(new URLSearchParams({ tab: 'history', page: '1', limit: String(histLimit) }), { replace: true });
      return;
    }
    setSearchParams(new URLSearchParams({ tab: 'stock', s_page: '1', s_limit: String(stockLimit) }), { replace: true });
  }

  const activeRefresh = tab === 'history' ? () => movementsQuery.refetch() : () => inventoryQuery.refetch();
  const activeRefreshing = tab === 'history' ? movementsQuery.isFetching : inventoryQuery.isFetching;

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button variant={tab === 'stock' ? 'default' : 'secondary'} size="sm" onClick={() => setParams({ tab: 'stock' })}>
              Stock
            </Button>
            <Button
              variant={tab === 'history' ? 'default' : 'secondary'}
              size="sm"
              disabled={!canSeeHistory}
              onClick={() => setParams({ tab: 'history' })}
            >
              History
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={activeRefresh} disabled={activeRefreshing}>
              <RefreshCw className={`mr-2 h-4 w-4 ${activeRefreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button variant="secondary" size="sm" onClick={resetCurrentTab}>
              Reset
            </Button>
          </div>
        </div>
        <div className="mt-3 text-xs text-muted-foreground">
          Stock adjustments require a reason and are recorded with actor + timestamp.
        </div>
        <div className="mt-3">
          <SavedFiltersBar
            moduleKey="inventory"
            currentParams={searchParams}
            paginationKeys={['page', 's_page']}
            onApply={(params) => setSearchParams(params, { replace: false })}
          />
        </div>
        {tab === 'stock' && stockProductId ? (
          <div className="mt-3 flex items-center justify-between rounded-md border bg-muted/20 px-3 py-2 text-xs">
            <div className="text-muted-foreground">
              Filtered by <span className="font-mono">{stockProductId}</span>
            </div>
            <Button size="sm" variant="secondary" onClick={() => setStockParams({ productId: undefined }, { resetPage: true })}>
              Clear
            </Button>
          </div>
        ) : null}
      </Card>

      {tab === 'stock' ? (
        <>
          {inventoryQuery.isError ? <ErrorState error={normalizeApiError(inventoryQuery.error)} onRetry={() => inventoryQuery.refetch()} /> : null}

          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="text-sm font-semibold">Inventory</div>
              <Select value={String(stockLimit)} onValueChange={(v) => setStockParams({ s_limit: v }, { resetPage: true })}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="50">50 / page</SelectItem>
                  <SelectItem value="100">100 / page</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="max-h-[72vh] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-muted/95 text-left text-xs text-muted-foreground backdrop-blur">
                  <tr>
                    <th className="px-4 py-3 font-medium">Product</th>
                    <th className="px-4 py-3 font-medium">SKU</th>
                    <th className="px-4 py-3 font-medium">Qty</th>
                    <th className="px-4 py-3 font-medium">Reserved</th>
                    <th className="px-4 py-3 font-medium">Available</th>
                    <th className="px-4 py-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {inventoryQuery.isLoading ? (
                    <tr>
                      <td className="px-4 py-6 text-muted-foreground" colSpan={6}>
                        Loading…
                      </td>
                    </tr>
                  ) : null}

                  {!inventoryQuery.isLoading && inventoryQuery.data?.items?.length === 0 ? (
                    <tr>
                      <td className="px-4 py-6 text-muted-foreground" colSpan={6}>
                        No variants found.
                      </td>
                    </tr>
                  ) : null}

                  {inventoryQuery.data?.items?.map((it) => {
                    const { qty, reserved, available } = stockRow(it);
                    return (
                      <tr key={it.variant._id} className="border-t">
                        <td className="px-4 py-3">
                          <div className="font-medium">{it.product?.name ?? '—'}</div>
                          <div className="text-xs text-muted-foreground">
                            {it.variant.volumeMl}ml · pack {it.variant.packSize}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">{it.variant.sku}</td>
                        <td className="px-4 py-3">{qty}</td>
                        <td className="px-4 py-3">{reserved}</td>
                        <td className="px-4 py-3">
                          <Badge variant={available <= 0 ? 'destructive' : available <= 5 ? 'warning' : 'default'}>{available}</Badge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setSelected(it);
                              setAdjustOpen(true);
                            }}
                          >
                            Adjust
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground">
              <div>{inventoryQuery.data ? `Page ${inventoryQuery.data.page} · ${inventoryQuery.data.total} total` : '—'}</div>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={stockPage <= 1 || inventoryQuery.isLoading}
                  onClick={() => setStockParams({ s_page: String(stockPage - 1) })}
                >
                  Prev
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={inventoryQuery.isLoading || !inventoryQuery.data || inventoryQuery.data.page * inventoryQuery.data.limit >= inventoryQuery.data.total}
                  onClick={() => setStockParams({ s_page: String(stockPage + 1) })}
                >
                  Next
                </Button>
              </div>
            </div>
          </Card>
        </>
      ) : null}

      {tab === 'history' ? (
        <>
          {!canSeeHistory ? (
            <Card className="p-6">
              <div className="text-sm text-muted-foreground">Only Admin and SuperAdmin can view inventory history.</div>
            </Card>
          ) : null}

          {canSeeHistory && movementsQuery.isError ? (
            <ErrorState error={normalizeApiError(movementsQuery.error)} onRetry={() => movementsQuery.refetch()} />
          ) : null}

          {canSeeHistory ? (
            <Card className="p-4">
              <div className="grid gap-3 md:grid-cols-5">
                <div className="grid gap-1 md:col-span-2">
                  <div className="text-xs text-muted-foreground">Product name or SKU</div>
                  <Input
                    defaultValue={histQ ?? ''}
                    placeholder="e.g. SKU-INV-1 or Super Beer"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const v = (e.currentTarget.value ?? '').trim();
                        setParams({ q: v || undefined }, { resetPage: true });
                      }
                    }}
                  />
                </div>
                <div className="grid gap-1">
                  <div className="text-xs text-muted-foreground">Actor (email contains)</div>
                  <Input
                    defaultValue={histActor ?? ''}
                    placeholder="e.g. employee@"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const v = (e.currentTarget.value ?? '').trim();
                        setParams({ actor: v || undefined }, { resetPage: true });
                      }
                    }}
                  />
                </div>
                <div className="grid gap-1">
                  <div className="text-xs text-muted-foreground">Type</div>
                  <Select value={histType ?? 'ALL'} onValueChange={(v) => setParams({ type: v === 'ALL' ? undefined : v }, { resetPage: true })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">All</SelectItem>
                      <SelectItem value="RECEIVE">RECEIVE</SelectItem>
                      <SelectItem value="ADJUST">ADJUST</SelectItem>
                      <SelectItem value="SALE">SALE</SelectItem>
                      <SelectItem value="RETURN">RETURN</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-1">
                  <div className="text-xs text-muted-foreground">From</div>
                  <Input type="date" value={histFrom ?? ''} onChange={(e) => setParams({ from: e.currentTarget.value || undefined }, { resetPage: true })} />
                </div>
                <div className="grid gap-1">
                  <div className="text-xs text-muted-foreground">To</div>
                  <Input type="date" value={histTo ?? ''} onChange={(e) => setParams({ to: e.currentTarget.value || undefined }, { resetPage: true })} />
                </div>

                <div className="flex items-end gap-2">
                  <Select value={String(histLimit)} onValueChange={(v) => setParams({ limit: v }, { resetPage: true })}>
                    <SelectTrigger className="w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="20">20 / page</SelectItem>
                      <SelectItem value="50">50 / page</SelectItem>
                      <SelectItem value="100">100 / page</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="secondary" onClick={() => setSearchParams(new URLSearchParams({ tab: 'history', page: '1', limit: String(histLimit) }), { replace: true })}>
                    Reset
                  </Button>
                </div>
              </div>
            </Card>
          ) : null}

          {canSeeHistory ? (
            <Card className="overflow-hidden">
              <div className="border-b px-4 py-3 text-sm font-semibold">Movement history</div>
              <div className="max-h-[72vh] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-muted/95 text-left text-xs text-muted-foreground backdrop-blur">
                    <tr>
                      <th className="px-4 py-3 font-medium">When</th>
                      <th className="px-4 py-3 font-medium">Product</th>
                      <th className="px-4 py-3 font-medium">SKU</th>
                      <th className="px-4 py-3 font-medium">Type</th>
                      <th className="px-4 py-3 font-medium">Delta</th>
                      <th className="px-4 py-3 font-medium">Qty</th>
                      <th className="px-4 py-3 font-medium">Actor</th>
                      <th className="px-4 py-3 font-medium">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movementsQuery.isLoading ? (
                      <tr>
                        <td className="px-4 py-6 text-muted-foreground" colSpan={8}>
                          Loading…
                        </td>
                      </tr>
                    ) : null}

                    {!movementsQuery.isLoading && movementsQuery.data?.items?.length === 0 ? (
                      <tr>
                        <td className="px-4 py-6 text-muted-foreground" colSpan={8}>
                          No movements found.
                        </td>
                      </tr>
                    ) : null}

                    {movementsQuery.data?.items?.map((m) => (
                      <tr key={m.id} className="border-t">
                        <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(m.createdAt)}</td>
                        <td className="px-4 py-3">{m.product?.name ?? '—'}</td>
                        <td className="px-4 py-3 font-mono text-xs">{m.variant?.sku ?? '—'}</td>
                        <td className="px-4 py-3">
                          <Badge>{m.type}</Badge>
                        </td>
                        <td className="px-4 py-3">{m.delta}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {typeof m.quantityBefore === 'number' && typeof m.quantityAfter === 'number'
                            ? `${m.quantityBefore} → ${m.quantityAfter}`
                            : '—'}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {m.actor.email} <span className="text-muted-foreground">({m.actor.role})</span>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{m.reason ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground">
                <div>{movementsQuery.data ? `Page ${movementsQuery.data.page} · ${movementsQuery.data.total} total` : '—'}</div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={histPage <= 1 || movementsQuery.isLoading}
                    onClick={() => setParams({ page: String(histPage - 1) })}
                  >
                    Prev
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={movementsQuery.isLoading || !movementsQuery.data || movementsQuery.data.page * movementsQuery.data.limit >= movementsQuery.data.total}
                    onClick={() => setParams({ page: String(histPage + 1) })}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </Card>
          ) : null}
        </>
      ) : null}

      <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adjust stock</DialogTitle>
            <DialogDescription>Delta and reason are required. This creates an audit movement entry.</DialogDescription>
          </DialogHeader>

          {selected ? (
            <div className="mt-4 grid gap-3 text-sm">
              <div className="rounded-md border p-3">
                <div className="font-medium">{selected.product?.name ?? '—'}</div>
                <div className="text-xs text-muted-foreground">{selected.variant.sku}</div>
              </div>

              <div className="grid gap-1">
                <div className="text-xs text-muted-foreground">Delta (non-zero integer)</div>
                <Input value={deltaStr} onChange={(e) => setDeltaStr(e.target.value)} placeholder="e.g. 5 or -2" />
              </div>

              <div className="grid gap-1">
                <div className="text-xs text-muted-foreground">Reason</div>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Explain why this change is needed…" />
              </div>

              <div className="rounded-md border p-3 text-xs text-muted-foreground">
                {(() => {
                  const { qty, reserved, available } = stockRow(selected);
                  const delta = Number(deltaStr);
                  const nextQty = Number.isFinite(delta) ? qty + delta : null;
                  return (
                    <div className="grid gap-1">
                      <div>Current quantity: {qty}</div>
                      <div>Reserved: {reserved}</div>
                      <div>Available: {available}</div>
                      <div className="mt-2 font-medium text-foreground">
                        New quantity: {nextQty === null ? '—' : nextQty}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="secondary" onClick={() => setAdjustOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={adjustMutation.isPending || !selected}
              onClick={() => {
                if (!selected) return;
                const delta = Number(deltaStr);
                if (!Number.isInteger(delta) || delta === 0) {
                  toast.error('Delta must be a non-zero integer');
                  return;
                }
                if (!reason.trim()) {
                  toast.error('Reason is required');
                  return;
                }
                adjustMutation.mutate({ variantId: selected.variant._id, delta, reason: reason.trim() });
              }}
            >
              Confirm adjustment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
