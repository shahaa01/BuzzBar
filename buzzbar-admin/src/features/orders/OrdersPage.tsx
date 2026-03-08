import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, RefreshCw, Search } from 'lucide-react';
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
import { adminAssignOrder, adminCancelOrder, adminListOrderAssignees, adminListOrders, adminTransitionOrder, adminUnassignOrder } from './orders.api.js';
import type { AdminOrderListItem, KycStatusSnapshot, OrderStatus, PaymentMethod, PaymentStatus } from './orders.types.js';

const STATUS_OPTIONS: Array<OrderStatus | 'ALL'> = [
  'ALL',
  'CREATED',
  'KYC_PENDING_REVIEW',
  'CONFIRMED',
  'PACKING',
  'READY_FOR_DISPATCH',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED'
];

const PAYMENT_METHOD_OPTIONS: Array<PaymentMethod | 'ALL'> = ['ALL', 'COD', 'WALLET'];
const PAYMENT_STATUS_OPTIONS: Array<PaymentStatus | 'ALL'> = ['ALL', 'UNPAID', 'PENDING', 'PAID', 'FAILED'];
const KYC_OPTIONS: Array<KycStatusSnapshot | 'ALL'> = ['ALL', 'not_started', 'pending', 'verified', 'rejected'];

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

function orderBadgeVariant(status: OrderStatus) {
  if (status === 'DELIVERED') return 'success' as const;
  if (status === 'CANCELLED') return 'destructive' as const;
  if (status === 'KYC_PENDING_REVIEW') return 'warning' as const;
  return 'default' as const;
}

function paymentBadgeVariant(status: PaymentStatus) {
  if (status === 'PAID') return 'success' as const;
  if (status === 'FAILED') return 'destructive' as const;
  if (status === 'PENDING') return 'warning' as const;
  return 'default' as const;
}

function kycBadgeVariant(status: KycStatusSnapshot) {
  if (status === 'verified') return 'success' as const;
  if (status === 'rejected') return 'destructive' as const;
  if (status === 'pending') return 'warning' as const;
  return 'default' as const;
}

function visibleActions(item: AdminOrderListItem) {
  return item.quickActions.filter((action) => action.allowed);
}

export function OrdersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const qc = useQueryClient();
  const { can } = useCapabilities();
  const canTransition = can('orders_transition');
  const canAssign = can('orders_assign');
  const canInspectPayments = can('payments_read');

  const status = (searchParams.get('status') ?? 'ALL').trim() as OrderStatus | 'ALL';
  const paymentMethod = (searchParams.get('paymentMethod') ?? 'ALL').trim() as PaymentMethod | 'ALL';
  const paymentStatus = (searchParams.get('paymentStatus') ?? 'ALL').trim() as PaymentStatus | 'ALL';
  const kycStatusSnapshot = (searchParams.get('kycStatusSnapshot') ?? 'ALL').trim() as KycStatusSnapshot | 'ALL';
  const assigned = (searchParams.get('assigned') ?? 'ALL').trim() as 'assigned' | 'unassigned' | 'ALL';
  const serviceArea = (searchParams.get('serviceArea') ?? '').trim() || undefined;
  const from = (searchParams.get('from') ?? '').trim() || undefined;
  const to = (searchParams.get('to') ?? '').trim() || undefined;
  const q = (searchParams.get('q') ?? '').trim() || undefined;
  const sort = (searchParams.get('sort') ?? 'createdAt_desc').trim() as 'createdAt_desc' | 'createdAt_asc' | 'total_desc' | 'total_asc';
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const limitRaw = Number(searchParams.get('limit') ?? '20') || 20;
  const limit = ([20, 50, 100].includes(limitRaw) ? limitRaw : 20) as 20 | 50 | 100;

  const [rowAssigneeSelection, setRowAssigneeSelection] = useState<Record<string, string>>({});
  const [pendingActionKey, setPendingActionKey] = useState('');
  const [actionError, setActionError] = useState<ApiErrorShape | null>(null);
  const [assignDialog, setAssignDialog] = useState<{ orderId: string; currentAssignee?: string; nextAssigneeId: string } | null>(null);
  const [unassignDialog, setUnassignDialog] = useState<{ orderId: string; currentAssignee?: string } | null>(null);
  const [cancelDialog, setCancelDialog] = useState<{ orderId: string; orderNumber: string } | null>(null);

  function setParam(next: Record<string, string | undefined>) {
    const sp = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(next)) {
      if (!v) sp.delete(k);
      else sp.set(k, v);
    }
    setSearchParams(sp, { replace: true });
  }

  function resetPageAndSet(next: Record<string, string | undefined>) {
    const sp = new URLSearchParams(searchParams);
    sp.set('page', '1');
    for (const [k, v] of Object.entries(next)) {
      if (!v) sp.delete(k);
      else sp.set(k, v);
    }
    setSearchParams(sp, { replace: true });
  }

  const listQuery = useQuery({
    queryKey: ['admin', 'orders', 'list', { status, paymentMethod, paymentStatus, kycStatusSnapshot, assigned, serviceArea, from, to, q, sort, page, limit }],
    queryFn: () =>
      adminListOrders({
        status: status === 'ALL' ? undefined : status,
        paymentMethod: paymentMethod === 'ALL' ? undefined : paymentMethod,
        paymentStatus: paymentStatus === 'ALL' ? undefined : paymentStatus,
        kycStatusSnapshot: kycStatusSnapshot === 'ALL' ? undefined : kycStatusSnapshot,
        assigned: assigned === 'ALL' ? undefined : assigned,
        serviceArea,
        from,
        to,
        q,
        sort,
        page,
        limit
      })
  });

  const assigneesQuery = useQuery({
    queryKey: ['admin', 'orders', 'assignees'],
    queryFn: adminListOrderAssignees,
    enabled: canAssign
  });

  const transitionMutation = useMutation({
    mutationFn: ({ id, actionId }: { id: string; actionId: string }) => adminTransitionOrder({ id, actionId }),
    onMutate: ({ id, actionId }) => {
      setActionError(null);
      setPendingActionKey(`${id}:${actionId}`);
    },
    onSuccess: async (result) => {
      toast.success(`Order moved to ${result.status}`);
      await qc.invalidateQueries({ queryKey: ['admin', 'orders'] });
    },
    onError: (err) => {
      setActionError(normalizeApiError(err));
    },
    onSettled: () => setPendingActionKey('')
  });

  const assignMutation = useMutation({
    mutationFn: ({ id, assignedToAdminId }: { id: string; assignedToAdminId: string }) => adminAssignOrder({ id, assignedToAdminId }),
    onMutate: ({ id, assignedToAdminId }) => {
      setActionError(null);
      setPendingActionKey(`${id}:assign:${assignedToAdminId}`);
    },
    onSuccess: async () => {
      toast.success('Assignment updated');
      setAssignDialog(null);
      await qc.invalidateQueries({ queryKey: ['admin', 'orders'] });
    },
    onError: (err) => {
      setActionError(normalizeApiError(err));
    },
    onSettled: () => setPendingActionKey('')
  });

  const unassignMutation = useMutation({
    mutationFn: ({ id }: { id: string }) => adminUnassignOrder({ id }),
    onMutate: ({ id }) => {
      setActionError(null);
      setPendingActionKey(`${id}:unassign`);
    },
    onSuccess: async () => {
      toast.success('Order unassigned');
      setUnassignDialog(null);
      await qc.invalidateQueries({ queryKey: ['admin', 'orders'] });
    },
    onError: (err) => {
      setActionError(normalizeApiError(err));
    },
    onSettled: () => setPendingActionKey('')
  });

  const cancelMutation = useMutation({
    mutationFn: ({ id }: { id: string }) => adminCancelOrder({ id, reason: 'admin_cancelled_from_orders_list' }),
    onMutate: ({ id }) => {
      setActionError(null);
      setPendingActionKey(`${id}:cancel`);
    },
    onSuccess: async () => {
      toast.success('Order cancelled');
      setCancelDialog(null);
      await qc.invalidateQueries({ queryKey: ['admin', 'orders'] });
    },
    onError: (err) => {
      setActionError(normalizeApiError(err));
    },
    onSettled: () => setPendingActionKey('')
  });

  const data = listQuery.data;

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
            <div className="grid min-w-0 gap-2 md:grid-cols-2 xl:grid-cols-5">
              <div className="grid min-w-0 gap-1">
                <div className="text-xs text-muted-foreground">Status</div>
                <Select value={status} onValueChange={(value) => resetPageAndSet({ status: value === 'ALL' ? undefined : value })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option === 'ALL' ? 'All statuses' : option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid min-w-0 gap-1">
                <div className="text-xs text-muted-foreground">Payment method</div>
                <Select value={paymentMethod} onValueChange={(value) => resetPageAndSet({ paymentMethod: value === 'ALL' ? undefined : value })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHOD_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option === 'ALL' ? 'All methods' : option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid min-w-0 gap-1">
                <div className="text-xs text-muted-foreground">Payment status</div>
                <Select value={paymentStatus} onValueChange={(value) => resetPageAndSet({ paymentStatus: value === 'ALL' ? undefined : value })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_STATUS_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option === 'ALL' ? 'All payment states' : option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid min-w-0 gap-1">
                <div className="text-xs text-muted-foreground">KYC snapshot</div>
                <Select value={kycStatusSnapshot} onValueChange={(value) => resetPageAndSet({ kycStatusSnapshot: value === 'ALL' ? undefined : value })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KYC_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option === 'ALL' ? 'All KYC states' : option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid min-w-0 gap-1">
                <div className="text-xs text-muted-foreground">Assignment</div>
                <Select value={assigned} onValueChange={(value) => resetPageAndSet({ assigned: value === 'ALL' ? undefined : value })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All</SelectItem>
                    <SelectItem value="assigned">Assigned</SelectItem>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex shrink-0 items-center justify-end gap-2">
              <Button variant="secondary" onClick={() => listQuery.refetch()} disabled={listQuery.isFetching}>
                <RefreshCw className={`mr-2 h-4 w-4 ${listQuery.isFetching ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              <Button variant="secondary" onClick={() => setSearchParams(new URLSearchParams(), { replace: true })}>
                Reset
              </Button>
            </div>
          </div>

          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(180px,0.85fr)_minmax(180px,0.85fr)]">
            <div className="grid min-w-0 gap-1">
              <div className="text-xs text-muted-foreground">Order / customer search</div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  key={q ?? 'q-empty'}
                  className="pl-9"
                  placeholder="Order number, customer name, email, phone"
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

            <div className="grid min-w-0 gap-1">
              <div className="text-xs text-muted-foreground">Service area</div>
              <Input
                key={serviceArea ?? 'area-empty'}
                placeholder="e.g. Kathmandu"
                defaultValue={serviceArea ?? ''}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    const value = event.currentTarget.value.trim();
                    resetPageAndSet({ serviceArea: value || undefined });
                  }
                }}
              />
            </div>

            <div className="grid min-w-0 gap-1">
              <div className="text-xs text-muted-foreground">From date</div>
              <Input type="date" value={from ?? ''} onChange={(event) => resetPageAndSet({ from: event.currentTarget.value || undefined })} />
            </div>

            <div className="grid min-w-0 gap-1">
              <div className="text-xs text-muted-foreground">To date</div>
              <Input type="date" value={to ?? ''} onChange={(event) => resetPageAndSet({ to: event.currentTarget.value || undefined })} />
            </div>
          </div>

          <SavedFiltersBar
            moduleKey="orders"
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
            <div className="text-sm font-semibold">Orders</div>
            <div className="mt-1 text-xs text-muted-foreground">Backend-driven transition buttons, assignment controls, and cancellation safety.</div>
          </div>
          <div className="rounded-full border border-border/70 bg-muted/50 px-3 py-1 text-xs text-muted-foreground">
            {data ? `Page ${data.page} · ${data.total} total` : 'Loading…'}
          </div>
        </div>

        {!listQuery.isLoading && data?.items?.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No orders match these filters"
              description="Reset the current filters or broaden the date and service-area constraints."
              actionLabel="Reset filters"
              onAction={() => setSearchParams(new URLSearchParams(), { replace: true })}
            />
          </div>
        ) : null}

        {data?.items?.length || listQuery.isLoading ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Order</th>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 font-medium">State</th>
                  <th className="px-4 py-3 font-medium">Total</th>
                  <th className="px-4 py-3 font-medium">Area</th>
                  <th className="px-4 py-3 font-medium">Assigned</th>
                  <th className="px-4 py-3 font-medium text-right">Quick actions</th>
                </tr>
              </thead>
              <tbody>
                {listQuery.isLoading
                  ? Array.from({ length: 6 }).map((_, index) => (
                      <tr key={`skeleton-${index}`} className="border-t">
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

                {data?.items?.map((item) => {
                  const actions = visibleActions(item);
                  const transitionActions = actions.filter((action) => action.id !== 'CANCEL_ORDER');
                  const cancelAction = actions.find((action) => action.id === 'CANCEL_ORDER');
                  const selectedAssignee = rowAssigneeSelection[item._id] ?? item.assignedTo?.id ?? '';
                  const detailHref = `/orders/${item._id}${location.search}`;

                  return (
                    <tr key={item._id} className="border-t align-top">
                      <td className="px-4 py-3">
                        <div className="font-medium">{item.orderNumber}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{item.paymentMethod}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{item.user?.name ?? item.user?.email ?? 'Guest'}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{item.user?.email ?? item.user?.phone ?? '—'}</div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{fmtDate(item.createdAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <Badge variant={orderBadgeVariant(item.status)}>{item.status}</Badge>
                          <Badge variant={paymentBadgeVariant(item.paymentStatus)}>{item.paymentStatus}</Badge>
                          <Badge variant={kycBadgeVariant(item.kycStatusSnapshot)}>{item.kycStatusSnapshot}</Badge>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-medium">{fmtMoney(item.total)}</td>
                      <td className="px-4 py-3">{item.addressSnapshot?.area ?? '—'}</td>
                      <td className="px-4 py-3">
                        <div className="text-sm">{item.assignedTo?.email ?? 'Unassigned'}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{item.assignedTo?.role ?? '—'}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col items-end gap-2">
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button asChild size="sm" variant="secondary">
                              <Link to={detailHref}>Open</Link>
                            </Button>
                            {canInspectPayments && item.paymentTransaction?.id ? (
                              <Button size="sm" variant="ghost" asChild>
                                <Link to={`/payments/${item.paymentTransaction.id}`}>Payment</Link>
                              </Button>
                            ) : null}
                            {canTransition
                              ? transitionActions.map((action) => {
                                  const pending = pendingActionKey === `${item._id}:${action.id}`;
                                  return (
                                    <Button key={action.id} size="sm" disabled={transitionMutation.isPending} onClick={() => transitionMutation.mutate({ id: item._id, actionId: action.id })}>
                                      {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                      {action.label}
                                    </Button>
                                  );
                                })
                              : null}
                            {canTransition && cancelAction ? (
                              <Button size="sm" variant="destructive" disabled={cancelMutation.isPending} onClick={() => setCancelDialog({ orderId: item._id, orderNumber: item.orderNumber })}>
                                {pendingActionKey === `${item._id}:cancel` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                Cancel
                              </Button>
                            ) : null}
                          </div>

                          {canAssign ? (
                            <div className="flex flex-wrap justify-end gap-2">
                              <Select value={selectedAssignee || 'NONE'} onValueChange={(value) => setRowAssigneeSelection((prev) => ({ ...prev, [item._id]: value === 'NONE' ? '' : value }))}>
                                <SelectTrigger className="w-[240px]">
                                  <SelectValue placeholder="Assign operator" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="NONE">Select assignee</SelectItem>
                                  {assigneesQuery.data?.map((assignee) => (
                                    <SelectItem key={assignee.id} value={assignee.id}>
                                      {assignee.email} ({assignee.role})
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={!selectedAssignee || selectedAssignee === item.assignedTo?.id || assignMutation.isPending}
                                onClick={() =>
                                  setAssignDialog({
                                    orderId: item._id,
                                    currentAssignee: item.assignedTo?.email,
                                    nextAssigneeId: selectedAssignee
                                  })
                                }
                              >
                                Assign
                              </Button>
                              {item.assignedTo ? (
                                <Button size="sm" variant="ghost" disabled={unassignMutation.isPending} onClick={() => setUnassignDialog({ orderId: item._id, currentAssignee: item.assignedTo?.email })}>
                                  Unassign
                                </Button>
                              ) : null}
                            </div>
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
            <Select value={String(limit)} onValueChange={(value) => resetPageAndSet({ limit: value })}>
              <SelectTrigger className="h-8 w-[120px] bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="20">20 / page</SelectItem>
                <SelectItem value="50">50 / page</SelectItem>
                <SelectItem value="100">100 / page</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={(value) => resetPageAndSet({ sort: value })}>
              <SelectTrigger className="h-8 w-[170px] bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="createdAt_desc">Newest first</SelectItem>
                <SelectItem value="createdAt_asc">Oldest first</SelectItem>
                <SelectItem value="total_desc">Total high to low</SelectItem>
                <SelectItem value="total_asc">Total low to high</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="secondary" size="sm" disabled={page <= 1 || listQuery.isFetching} onClick={() => setParam({ page: String(page - 1) })}>
              Prev
            </Button>
            <Button variant="secondary" size="sm" disabled={listQuery.isFetching || !data || data.page * data.limit >= data.total} onClick={() => setParam({ page: String(page + 1) })}>
              Next
            </Button>
          </div>
        </div>
      </Card>

      <Dialog open={Boolean(assignDialog)} onOpenChange={(open) => !open && setAssignDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{assignDialog?.currentAssignee ? 'Reassign order?' : 'Assign order?'}</DialogTitle>
            <DialogDescription>
              {assignDialog?.currentAssignee ? `Current assignee: ${assignDialog.currentAssignee}` : 'This order will be assigned to the selected operator.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setAssignDialog(null)}>
              Back
            </Button>
            <Button
              disabled={!assignDialog || assignMutation.isPending}
              onClick={() => assignDialog && assignMutation.mutate({ id: assignDialog.orderId, assignedToAdminId: assignDialog.nextAssigneeId })}
            >
              {assignDialog && pendingActionKey === `${assignDialog.orderId}:assign:${assignDialog.nextAssigneeId}` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirm assignment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(unassignDialog)} onOpenChange={(open) => !open && setUnassignDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unassign this order?</DialogTitle>
            <DialogDescription>{unassignDialog?.currentAssignee ? `Current assignee: ${unassignDialog.currentAssignee}` : 'The current assignee will be removed.'}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setUnassignDialog(null)}>
              Keep assignee
            </Button>
            <Button variant="destructive" disabled={!unassignDialog || unassignMutation.isPending} onClick={() => unassignDialog && unassignMutation.mutate({ id: unassignDialog.orderId })}>
              {unassignDialog && pendingActionKey === `${unassignDialog.orderId}:unassign` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Unassign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(cancelDialog)} onOpenChange={(open) => !open && setCancelDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this order?</DialogTitle>
            <DialogDescription>{cancelDialog?.orderNumber ? `Order ${cancelDialog.orderNumber} will be cancelled and reserved stock will be released.` : 'Reserved stock will be released.'}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCancelDialog(null)}>
              Keep order
            </Button>
            <Button variant="destructive" disabled={!cancelDialog || cancelMutation.isPending} onClick={() => cancelDialog && cancelMutation.mutate({ id: cancelDialog.orderId })}>
              {cancelDialog && pendingActionKey === `${cancelDialog.orderId}:cancel` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Cancel order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
