import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ErrorState } from '../../components/feedback/ErrorState.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card } from '../../components/ui/card.js';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select.js';
import { Skeleton } from '../../components/ui/skeleton.js';
import { Textarea } from '../../components/ui/textarea.js';
import { normalizeApiError, type ApiErrorShape } from '../../lib/api/normalizeError.js';
import { useCapabilities } from '../../lib/permissions/useCapabilities.js';
import { adminAssignOrder, adminCancelOrder, adminGetOrderDetail, adminListOrderAssignees, adminTransitionOrder, adminUnassignOrder } from './orders.api.js';
import type { KycStatusSnapshot, OrderStatus, PaymentStatus } from './orders.types.js';

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

function statusBadgeClass(status: OrderStatus) {
  if (status === 'CREATED') return 'border-blue-500/20 bg-blue-500/15 text-blue-100';
  if (status === 'CONFIRMED') return 'border-cyan-500/20 bg-cyan-500/15 text-cyan-100';
  if (status === 'PACKING') return 'border-amber-500/20 bg-amber-500/15 text-amber-100';
  if (status === 'READY_FOR_DISPATCH') return 'border-fuchsia-500/20 bg-fuchsia-500/15 text-fuchsia-100';
  if (status === 'OUT_FOR_DELIVERY') return 'border-orange-500/20 bg-orange-500/15 text-orange-100';
  if (status === 'DELIVERED') return 'border-emerald-500/20 bg-emerald-500/15 text-emerald-100';
  if (status === 'CANCELLED') return 'border-rose-500/20 bg-rose-500/15 text-rose-100';
  return 'border-primary/20 bg-primary/15 text-primary-foreground';
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

function DetailRow(props: { label: string; value: ReactNode; copyValue?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{props.label}</div>
      <div className="flex items-center gap-2 text-right text-sm text-foreground">
        <span>{props.value}</span>
        {props.copyValue ? <CopyValueButton label={props.label} value={props.copyValue} /> : null}
      </div>
    </div>
  );
}

function CopyValueButton(props: { label: string; value: string }) {
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
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

function SummaryChip(props: { label: string; active?: boolean }) {
  return (
    <div className={`rounded-full border px-3 py-1 text-xs ${props.active ? 'border-primary/30 bg-primary/15 text-foreground' : 'border-white/10 text-muted-foreground'}`}>
      {props.label}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-4">
      <Card className="border-white/10 bg-white/[0.03] p-6">
        <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <div className="space-y-3">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-4 w-72" />
            <div className="flex flex-wrap gap-2">
              <Skeleton className="h-6 w-24" />
              <Skeleton className="h-6 w-24" />
              <Skeleton className="h-6 w-24" />
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        </div>
      </Card>
      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-4">
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-60 w-full" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-44 w-full" />
        </div>
      </div>
    </div>
  );
}

export function OrderDetailPage() {
  const params = useParams();
  const id = String(params.id ?? '');
  const location = useLocation();
  const qc = useQueryClient();
  const { can } = useCapabilities();
  const canInspectPayments = can('payments_read');
  const canTransition = can('orders_transition');
  const canAssign = can('orders_assign');

  const detailQuery = useQuery({
    queryKey: ['admin', 'orders', 'detail', id],
    queryFn: () => adminGetOrderDetail(id),
    enabled: Boolean(id)
  });

  const assigneesQuery = useQuery({
    queryKey: ['admin', 'orders', 'assignees'],
    queryFn: adminListOrderAssignees,
    enabled: Boolean(id) && canAssign
  });

  const transitionOrder = useMutation({
    mutationFn: ({ actionId }: { actionId: string }) => adminTransitionOrder({ id, actionId }),
    onMutate: ({ actionId }) => {
      setActionError(null);
      setPendingActionKey(actionId);
    },
    onSuccess: async (result) => {
      toast.success(`Order moved to ${result.status}`);
      await qc.invalidateQueries({ queryKey: ['admin', 'orders', 'list'] });
      await qc.invalidateQueries({ queryKey: ['admin', 'orders', 'detail', id] });
    },
    onError: (err) => {
      setActionError(normalizeApiError(err));
    },
    onSettled: () => setPendingActionKey('')
  });

  const assignOrder = useMutation({
    mutationFn: (assignedToAdminId: string) => adminAssignOrder({ id, assignedToAdminId }),
    onMutate: (assignedToAdminId) => {
      setActionError(null);
      setPendingActionKey(`assign:${assignedToAdminId}`);
    },
    onSuccess: async () => {
      toast.success('Assignment updated');
      setAssignOpen(false);
      setSelectedAssignee('');
      await qc.invalidateQueries({ queryKey: ['admin', 'orders'] });
    },
    onError: (err) => {
      setActionError(normalizeApiError(err));
    },
    onSettled: () => setPendingActionKey('')
  });

  const unassignOrder = useMutation({
    mutationFn: () => adminUnassignOrder({ id }),
    onMutate: () => {
      setActionError(null);
      setPendingActionKey('unassign');
    },
    onSuccess: async () => {
      toast.success('Assignment cleared');
      setUnassignOpen(false);
      setSelectedAssignee('');
      await qc.invalidateQueries({ queryKey: ['admin', 'orders'] });
    },
    onError: (err) => {
      setActionError(normalizeApiError(err));
    },
    onSettled: () => setPendingActionKey('')
  });

  const cancelOrder = useMutation({
    mutationFn: (reason?: string) => adminCancelOrder({ id, reason }),
    onMutate: () => {
      setActionError(null);
      setPendingActionKey('CANCEL_ORDER');
    },
    onSuccess: async () => {
      toast.success('Order cancelled');
      setCancelOpen(false);
      setCancelReason('');
      await qc.invalidateQueries({ queryKey: ['admin', 'orders'] });
    },
    onError: (err) => {
      setActionError(normalizeApiError(err));
    },
    onSettled: () => setPendingActionKey('')
  });

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [assignOpen, setAssignOpen] = useState(false);
  const [unassignOpen, setUnassignOpen] = useState(false);
  const [selectedAssignee, setSelectedAssignee] = useState('');
  const [actionError, setActionError] = useState<ApiErrorShape | null>(null);
  const [pendingActionKey, setPendingActionKey] = useState('');

  const data = detailQuery.data;
  const order = data?.order;
  const items = data?.items ?? [];
  const actions = data?.operational.allowedActions ?? [];
  const currentAssigneeId = data?.assignment.assignedOperator?.id ?? '';
  const isMutating = transitionOrder.isPending || cancelOrder.isPending || assignOrder.isPending || unassignOrder.isPending;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" asChild>
            <Link to={`/orders${location.search}`}>Back</Link>
          </Button>
          <div>
            <div className="text-xs uppercase tracking-[0.28em] text-muted-foreground">Order Detail</div>
            <div className="mt-1 text-lg font-semibold text-foreground">{order?.orderNumber ?? 'Order'}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => detailQuery.refetch()} disabled={detailQuery.isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${detailQuery.isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {detailQuery.isError ? <ErrorState error={normalizeApiError(detailQuery.error)} onRetry={() => detailQuery.refetch()} /> : null}
      {actionError ? <ErrorState error={actionError} onRetry={() => detailQuery.refetch()} /> : null}
      {detailQuery.isLoading ? <DetailSkeleton /> : null}

      {order && data ? (
        <>
          <Card className="overflow-hidden border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(220,180,120,0.18),transparent_34%),linear-gradient(135deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-6 shadow-[0_22px_80px_rgba(0,0,0,0.35)]">
            <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={statusBadgeClass(order.status)}>{order.status}</Badge>
                  <Badge variant={paymentBadgeVariant(order.paymentStatus)}>{order.paymentStatus}</Badge>
                  <Badge variant={kycBadgeVariant(data.kyc.status)}>{data.kyc.status.toUpperCase()}</Badge>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <div>
                    <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Order Number</div>
                    <div className="mt-1 flex items-center gap-2 text-2xl font-semibold text-foreground">
                      {order.orderNumber}
                      <CopyValueButton label="Order number" value={order.orderNumber} />
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Created Time</div>
                    <div className="mt-1 text-sm text-foreground">{fmtDate(order.createdAt)}</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <SummaryChip label={data.inventory.stockReserved ? 'Stock Reserved' : 'Stock Released'} active={data.inventory.stockReserved} />
                  <SummaryChip label={data.kyc.status === 'pending' ? 'KYC Pending' : 'KYC Clear'} active={data.kyc.status === 'pending'} />
                  <SummaryChip label={order.paymentStatus === 'PENDING' ? 'Payment Pending' : 'Payment Clear'} active={order.paymentStatus === 'PENDING'} />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <Card className="border-white/10 bg-black/20 p-4">
                  <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Total Amount</div>
                  <div className="mt-2 text-2xl font-semibold text-foreground">{fmtMoney(order.total)}</div>
                </Card>
                <Card className="border-white/10 bg-black/20 p-4">
                  <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Service Area</div>
                  <div className="mt-2 text-lg font-medium text-foreground">{data.customer?.serviceArea ?? order.addressSnapshot.area ?? '—'}</div>
                </Card>
              </div>
            </div>
          </Card>

          <div className="grid gap-4 xl:grid-cols-[1.65fr_1fr]">
            <div className="space-y-4">
              <SectionCard title="Overview" subtitle="Operational summary for this order.">
                <div className="divide-y divide-white/10">
                  <DetailRow label="Order ID" value={order.id} copyValue={order.id} />
                  <DetailRow label="Order Number" value={order.orderNumber} copyValue={order.orderNumber} />
                  <DetailRow label="Service Area" value={data.customer?.serviceArea ?? '—'} />
                  <DetailRow label="Created" value={fmtDate(order.createdAt)} />
                  <DetailRow label="Updated" value={fmtDate(order.updatedAt)} />
                  <DetailRow label="Payment Method" value={order.paymentMethod} />
                  <DetailRow label="Payment Status" value={order.paymentStatus} />
                  <DetailRow label="Total Amount" value={fmtMoney(order.total)} />
                </div>
              </SectionCard>

              <SectionCard title="Customer" subtitle="Delivery snapshot plus current user contact details.">
                <div className="divide-y divide-white/10">
                  <DetailRow label="User ID" value={data.customer?.userId ?? '—'} copyValue={data.customer?.userId} />
                  <DetailRow label="Customer Name" value={data.customer?.name ?? order.addressSnapshot.contactName ?? '—'} />
                  <DetailRow label="Phone" value={data.customer?.phone ?? order.addressSnapshot.contactPhone ?? '—'} />
                  <DetailRow label="Address" value={order.addressSnapshot.fullAddress ?? '—'} />
                  <DetailRow label="Landmark" value={order.addressSnapshot.landmark ?? '—'} />
                  <DetailRow label="Service Area" value={data.customer?.serviceArea ?? '—'} />
                </div>
              </SectionCard>

              <SectionCard title="Items Snapshot" subtitle="Frozen order snapshot. These values do not follow later catalog changes.">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[920px] text-sm">
                    <thead className="text-left text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                      <tr>
                        <th className="pb-3 pr-3 font-medium">Product</th>
                        <th className="pb-3 pr-3 font-medium">Brand</th>
                        <th className="pb-3 pr-3 font-medium">Variant</th>
                        <th className="pb-3 pr-3 font-medium">SKU</th>
                        <th className="pb-3 pr-3 font-medium">Unit Price</th>
                        <th className="pb-3 pr-3 font-medium">Qty</th>
                        <th className="pb-3 text-right font-medium">Line Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.length === 0 ? (
                        <tr>
                          <td className="py-6 text-muted-foreground" colSpan={7}>
                            No item snapshot found.
                          </td>
                        </tr>
                      ) : null}
                      {items.map((item) => (
                        <tr key={`${item.variantId}-${item.productId}`} className="border-t border-white/10">
                          <td className="py-3 pr-3">
                            <div className="flex items-center gap-3">
                              <div className="h-12 w-12 overflow-hidden rounded-xl border border-white/10 bg-black/20">
                                {item.imageUrl ? <img src={item.imageUrl} alt={item.productName} className="h-full w-full object-cover" /> : null}
                              </div>
                              <div>
                                <div className="font-medium text-foreground">{item.productName}</div>
                                <div className="text-xs text-muted-foreground">{item.imageUrl ? 'Snapshot image' : 'No image in snapshot'}</div>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 pr-3 text-foreground">{item.brandName ?? '—'}</td>
                          <td className="py-3 pr-3 text-muted-foreground">
                            {item.volumeMl}ml · pack {item.packSize}
                          </td>
                          <td className="py-3 pr-3 font-mono text-xs text-foreground">{item.sku ?? '—'}</td>
                          <td className="py-3 pr-3 text-foreground">{fmtMoney(item.unitPrice)}</td>
                          <td className="py-3 pr-3 text-foreground">{item.qty}</td>
                          <td className="py-3 text-right font-medium text-foreground">{fmtMoney(item.lineTotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </SectionCard>
            </div>

            <div className="space-y-4">
              <SectionCard title="Totals" subtitle="Frozen pricing at order creation time.">
                <div className="divide-y divide-white/10">
                  <DetailRow label="Subtotal" value={fmtMoney(data.totals.subtotal)} />
                  <DetailRow label="Discount" value={`-${fmtMoney(data.totals.discount)}`} />
                  <DetailRow label="Delivery Fee" value={fmtMoney(data.totals.deliveryFee)} />
                  <DetailRow label="Promo Applied" value={data.totals.promoApplied ?? '—'} />
                  <DetailRow label="Final Total" value={<span className="font-semibold">{fmtMoney(data.totals.total)}</span>} />
                </div>
              </SectionCard>

              <SectionCard title="Operational Status" subtitle="Only backend-computed valid actions are exposed here.">
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3">
                    <div>
                      <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Current Status</div>
                      <div className="mt-1 font-medium text-foreground">{data.operational.currentStatus}</div>
                    </div>
                    <Badge className={statusBadgeClass(data.operational.currentStatus)}>{data.operational.currentStatus}</Badge>
                  </div>

                  <div className="grid gap-2">
                    {!canTransition ? <div className="text-sm text-muted-foreground">This session can inspect order state but cannot perform transitions.</div> : null}
                    {canTransition && actions.length === 0 ? <div className="text-sm text-muted-foreground">No valid next actions.</div> : null}
                    {canTransition &&
                      actions.map((action) => {
                        const pending = pendingActionKey === action.id;
                      if (action.toStatus === 'CANCELLED') {
                        return (
                          <Button key={action.id} variant="destructive" disabled={isMutating} onClick={() => setCancelOpen(true)}>
                            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            {action.label}
                          </Button>
                        );
                      }
                      return (
                        <Button key={action.id} disabled={isMutating} onClick={() => transitionOrder.mutate({ actionId: action.id })}>
                          {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                          {action.label}
                        </Button>
                      );
                    })}
                  </div>

                  {data.operational.blockingConditions.length > 0 ? (
                    <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4">
                      <div className="text-xs uppercase tracking-[0.22em] text-amber-100/80">Blocking Conditions</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {data.operational.blockingConditions.map((condition) => (
                          <Badge key={condition} variant="warning">
                            {condition}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </SectionCard>

              <SectionCard title="Assignment" subtitle="Current assignee plus assignment controls.">
                <div className="space-y-4">
                  <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Assigned Operator</div>
                    <div className="mt-1 text-sm font-medium text-foreground">
                      {data.assignment.assignedOperator ? `${data.assignment.assignedOperator.email} (${data.assignment.assignedOperator.role})` : 'Unassigned'}
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">Assigned At: {fmtDate(data.assignment.assignedAt)}</div>
                  </div>

                  {canAssign ? (
                    <div className="grid gap-2">
                      <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Assign or Reassign</div>
                      <Select value={selectedAssignee || currentAssigneeId || '__placeholder__'} onValueChange={(value) => setSelectedAssignee(value)}>
                        <SelectTrigger>
                          <SelectValue placeholder="Choose operator" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__placeholder__" disabled>
                            Choose operator
                          </SelectItem>
                          {(assigneesQuery.data ?? []).map((assignee) => (
                            <SelectItem key={assignee.id} value={assignee.id}>
                              {assignee.email} · {assignee.role}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="flex gap-2">
                        <Button variant="secondary" disabled={!selectedAssignee || selectedAssignee === currentAssigneeId || assignOrder.isPending} onClick={() => setAssignOpen(true)}>
                          {data.assignment.assignedOperator ? 'Reassign' : 'Assign'}
                        </Button>
                        <Button variant="ghost" disabled={!data.assignment.assignedOperator || unassignOrder.isPending} onClick={() => setUnassignOpen(true)}>
                          Unassign
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">This session can view assignment state but cannot change it.</div>
                  )}

                  {data.assignment.history.length > 0 ? (
                    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                      <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Assignment Audit</div>
                      <div className="mt-3 space-y-3">
                        {data.assignment.history.map((entry) => (
                          <div key={entry.id} className="rounded-lg border border-white/10 px-3 py-2 text-sm">
                            <div className="font-medium text-foreground">{entry.actionId}</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {fmtDate(entry.createdAt)} · by {entry.actor?.email ?? 'system'}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {entry.previousAssignedTo?.email ?? 'Unassigned'} → {entry.assignedTo?.email ?? 'Unassigned'}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </SectionCard>

              <SectionCard title="Payment" subtitle="Current payment state and latest transaction.">
                <div className="divide-y divide-white/10">
                  <DetailRow label="Payment Method" value={data.payment.method} />
                  <DetailRow label="Payment Status" value={data.payment.status} />
                  <DetailRow label="Amount" value={fmtMoney(data.payment.amount)} />
                  <DetailRow label="Provider" value={data.payment.transaction?.provider ?? '—'} />
                  <DetailRow
                    label="Transaction ID"
                    value={
                      data.payment.transaction ? (
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs">{data.payment.transaction.id}</span>
                          {canInspectPayments ? (
                            <Button variant="ghost" size="sm" asChild>
                              <Link to={`/payments/${data.payment.transaction.id}`}>
                                View
                                <ExternalLink className="ml-2 h-4 w-4" />
                              </Link>
                            </Button>
                          ) : null}
                        </div>
                      ) : (
                        '—'
                      )
                    }
                    copyValue={data.payment.transaction?.id}
                  />
                  <DetailRow label="Provider Reference" value={data.payment.transaction?.providerReference ?? '—'} copyValue={data.payment.transaction?.providerReference} />
                  <DetailRow label="Transaction Status" value={data.payment.transaction?.status ?? '—'} />
                </div>
                {data.payment.transaction?.failureReason ? (
                  <div className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-100">
                    {data.payment.transaction.failureReason}
                  </div>
                ) : null}
              </SectionCard>

              <SectionCard title="Inventory Effects" subtitle="Derived from the order lifecycle and stock reservation rules.">
                <div className="divide-y divide-white/10">
                  <DetailRow label="Stock Reserved" value={data.inventory.stockReserved ? 'Yes' : 'No'} />
                  <DetailRow label="Reserved Units" value={String(data.inventory.reservedUnits)} />
                  <DetailRow label="Stock Deducted" value={data.inventory.stockDeducted ? 'Yes' : 'No'} />
                  <DetailRow label="Deducted Units" value={String(data.inventory.deductedUnits)} />
                  <DetailRow label="Reservation Timestamp" value={fmtDate(data.inventory.reservationTimestamp)} />
                </div>
              </SectionCard>

              <SectionCard title="KYC Gate" subtitle="Current KYC state and order gating summary.">
                <div className="divide-y divide-white/10">
                  <DetailRow label="KYC Status" value={data.kyc.status.toUpperCase()} />
                  <DetailRow label="KYC Snapshot" value={data.kyc.statusSnapshot.toUpperCase()} />
                  <DetailRow label="Gate Status" value={data.kyc.gateStatus} />
                  <DetailRow label="Verified At" value={fmtDate(data.kyc.verifiedAt)} />
                  <DetailRow label="Rejected At" value={fmtDate(data.kyc.rejectedAt)} />
                  <DetailRow label="Rejection Reason" value={data.kyc.rejectionReason ?? '—'} />
                </div>
                {data.kyc.blockedReason ? (
                  <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-100">{data.kyc.blockedReason}</div>
                ) : null}
              </SectionCard>

              <SectionCard title="Audit Metadata" subtitle="System timestamps and operator-safe identifiers.">
                <div className="divide-y divide-white/10">
                  <DetailRow label="Created At" value={fmtDate(data.audit.createdAt)} />
                  <DetailRow label="Updated At" value={fmtDate(data.audit.updatedAt)} />
                  <DetailRow label="Cancelled At" value={fmtDate(data.audit.cancelledAt)} />
                  <DetailRow label="Delivered At" value={fmtDate(data.audit.deliveredAt)} />
                  <DetailRow label="Created By" value={data.audit.createdBy.type} />
                  <DetailRow label="Created By User ID" value={data.audit.createdBy.userId ?? '—'} copyValue={data.audit.createdBy.userId} />
                  <DetailRow label="Cancel Reason" value={data.audit.cancelReason ?? '—'} />
                </div>
              </SectionCard>
            </div>
          </div>
        </>
      ) : null}

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this order?</DialogTitle>
            <DialogDescription>This releases reserved stock and ends the operational flow for the order.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Reason</div>
            <Textarea value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Customer requested cancellation, payment issue, duplicate order..." />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCancelOpen(false)}>
              Keep order
            </Button>
            <Button variant="destructive" disabled={cancelOrder.isPending} onClick={() => cancelOrder.mutate(cancelReason.trim() || undefined)}>
              {pendingActionKey === 'CANCEL_ORDER' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Cancel order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{currentAssigneeId ? 'Reassign order?' : 'Assign order?'}</DialogTitle>
            <DialogDescription>The current assignee will be replaced immediately once confirmed.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setAssignOpen(false)}>
              Back
            </Button>
            <Button disabled={!selectedAssignee || assignOrder.isPending} onClick={() => assignOrder.mutate(selectedAssignee)}>
              {pendingActionKey === `assign:${selectedAssignee}` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirm assignment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={unassignOpen} onOpenChange={setUnassignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unassign this order?</DialogTitle>
            <DialogDescription>The order will remain operational but no longer be tied to the current assignee.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setUnassignOpen(false)}>
              Keep assignee
            </Button>
            <Button variant="destructive" disabled={unassignOrder.isPending} onClick={() => unassignOrder.mutate()}>
              {pendingActionKey === 'unassign' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Unassign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
