import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useBeforeUnload, useBlocker, useLocation, useNavigate, useParams } from 'react-router-dom';
import { type Resolver, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { AlertTriangle, CheckCircle2, Clock3, RefreshCw } from 'lucide-react';
import { ErrorState } from '../../components/feedback/ErrorState.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card } from '../../components/ui/card.js';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog.js';
import { Input } from '../../components/ui/input.js';
import { Label } from '../../components/ui/label.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select.js';
import { Skeleton } from '../../components/ui/skeleton.js';
import { Textarea } from '../../components/ui/textarea.js';
import { normalizeApiError, type ApiErrorShape } from '../../lib/api/normalizeError.js';
import { useCapabilities } from '../../lib/permissions/useCapabilities.js';
import { adminListBrands } from '../catalog/brands/brands.api.js';
import { adminListCategories } from '../catalog/categories/categories.api.js';
import { adminListProducts } from '../catalog/products/products.api.js';
import { adminCreatePromotion, adminDeactivatePromotion, adminGetPromotion, adminUpdatePromotion } from './promotions.api.js';
import type { PromotionDetail, PromotionListItem, PromotionUpsertInput, PromotionValidityStatus } from './promotions.types.js';

const schema = z
  .object({
    code: z.string().trim().min(3, 'Code is required').max(40).regex(/^[A-Za-z0-9_-]+$/, 'Use letters, numbers, hyphens, or underscores'),
    title: z.string().trim().min(1, 'Title is required').max(140),
    description: z.string().max(2000).optional(),
    type: z.enum(['PERCENT', 'FLAT']),
    value: z.coerce.number().positive('Discount value must be greater than zero'),
    minSubtotal: z.string().optional(),
    maxDiscount: z.string().optional(),
    usageLimitTotal: z.string().optional(),
    usageLimitPerUser: z.string().optional(),
    startAt: z.string().min(1, 'Start time is required'),
    endAt: z.string().min(1, 'End time is required'),
    isActive: z.enum(['true', 'false']),
    eligibleCategoryIds: z.array(z.string()).default([]),
    eligibleBrandIds: z.array(z.string()).default([]),
    eligibleProductIds: z.array(z.string()).default([]),
    excludeDiscountedItems: z.boolean().default(false)
  })
  .superRefine((value, ctx) => {
    const startAt = new Date(value.startAt);
    const endAt = new Date(value.endAt);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || startAt.getTime() >= endAt.getTime()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'End time must be after start time', path: ['endAt'] });
    }

    if (value.type === 'PERCENT' && value.value > 100) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Percent discounts cannot exceed 100%', path: ['value'] });
    }

    for (const field of ['minSubtotal', 'maxDiscount', 'usageLimitTotal', 'usageLimitPerUser'] as const) {
      const raw = value[field];
      if (!raw) continue;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed < 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Must be zero or greater', path: [field] });
      }
    }
  });

type PromotionFormValues = z.infer<typeof schema>;

function statusVariant(status: PromotionListItem['status']) {
  if (status === 'live') return 'success' as const;
  if (status === 'inactive') return 'destructive' as const;
  if (status === 'expired') return 'warning' as const;
  return 'default' as const;
}

function validityVariant(status: PromotionValidityStatus) {
  if (status === 'live') return 'success' as const;
  if (status === 'invalid') return 'destructive' as const;
  if (status === 'scheduled' || status === 'expired') return 'warning' as const;
  return 'default' as const;
}

function formatMoney(value: number) {
  return `NPR ${Math.trunc(value)}`;
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function formatDateRange(start?: string | null, end?: string | null) {
  return `${formatDate(start)} → ${formatDate(end)}`;
}

function isoToLocalDateTimeInput(iso?: string | null) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

function detailToFormValues(detail?: PromotionListItem | null): PromotionFormValues {
  return {
    code: detail?.code ?? '',
    title: detail?.title ?? '',
    description: detail?.description ?? '',
    type: detail?.type ?? 'PERCENT',
    value: detail?.value ?? 10,
    minSubtotal: detail?.minSubtotal != null ? String(detail.minSubtotal) : '',
    maxDiscount: detail?.maxDiscount != null ? String(detail.maxDiscount) : '',
    usageLimitTotal: detail?.usageLimitTotal != null ? String(detail.usageLimitTotal) : '',
    usageLimitPerUser: detail?.usageLimitPerUser != null ? String(detail.usageLimitPerUser) : '',
    startAt: isoToLocalDateTimeInput(detail?.startAt),
    endAt: isoToLocalDateTimeInput(detail?.endAt),
    isActive: detail?.isActive === false ? 'false' : 'true',
    eligibleCategoryIds: detail?.eligibleCategoryIds ?? [],
    eligibleBrandIds: detail?.eligibleBrandIds ?? [],
    eligibleProductIds: detail?.eligibleProductIds ?? [],
    excludeDiscountedItems: detail?.excludeDiscountedItems ?? false
  };
}

function buildPayload(values: PromotionFormValues): PromotionUpsertInput {
  return {
    code: values.code.trim().toUpperCase(),
    title: values.title.trim(),
    description: values.description?.trim() ? values.description.trim() : null,
    type: values.type,
    value: Math.trunc(values.value),
    minSubtotal: values.minSubtotal ? Math.trunc(Number(values.minSubtotal)) : null,
    maxDiscount: values.maxDiscount ? Math.trunc(Number(values.maxDiscount)) : null,
    usageLimitTotal: values.usageLimitTotal ? Math.trunc(Number(values.usageLimitTotal)) : null,
    usageLimitPerUser: values.usageLimitPerUser ? Math.trunc(Number(values.usageLimitPerUser)) : null,
    startAt: new Date(values.startAt).toISOString(),
    endAt: new Date(values.endAt).toISOString(),
    isActive: values.isActive === 'true',
    eligibleCategoryIds: values.eligibleCategoryIds,
    eligibleBrandIds: values.eligibleBrandIds,
    eligibleProductIds: values.eligibleProductIds,
    excludeDiscountedItems: values.excludeDiscountedItems
  };
}

function toggleArrayValue(list: string[], value: string) {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function MultiSelectCard(props: {
  title: string;
  items: Array<{ id: string; label: string; description?: string | null }>;
  values: string[];
  disabled: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <Card className="p-4">
      <div className="text-sm font-semibold">{props.title}</div>
      <div className="mt-3 max-h-56 space-y-2 overflow-auto pr-1">
        {props.items.length === 0 ? <div className="text-sm text-muted-foreground">No options available.</div> : null}
        {props.items.map((item) => {
          const checked = props.values.includes(item.id);
          return (
            <label key={item.id} className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 ${checked ? 'border-primary/60 bg-primary/10' : 'border-border/70 bg-background/40'} ${props.disabled ? 'cursor-not-allowed opacity-70' : ''}`}>
              <input type="checkbox" className="mt-1 h-4 w-4 accent-[hsl(var(--primary))]" checked={checked} disabled={props.disabled} onChange={() => props.onToggle(item.id)} />
              <div className="min-w-0">
                <div className="text-sm">{item.label}</div>
                {item.description ? <div className="mt-1 text-xs text-muted-foreground">{item.description}</div> : null}
              </div>
            </label>
          );
        })}
      </div>
    </Card>
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

function DetailRow(props: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{props.label}</div>
      <div className="text-right text-sm text-foreground">{props.value}</div>
    </div>
  );
}

function SummaryList(props: { items: string[]; emptyLabel: string }) {
  if (props.items.length === 0) {
    return <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-sm text-muted-foreground">{props.emptyLabel}</div>;
  }

  return (
    <div className="space-y-2">
      {props.items.map((item) => (
        <div key={item} className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-sm">
          {item}
        </div>
      ))}
    </div>
  );
}

function EntityPills(props: { title: string; items: Array<{ id: string; name: string; slug: string; isActive: boolean }> }) {
  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{props.title}</div>
      {props.items.length === 0 ? (
        <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-sm text-muted-foreground">No restrictions</div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {props.items.map((item) => (
            <div key={item.id} className="rounded-full border border-border/70 bg-muted/20 px-3 py-1 text-xs text-foreground">
              {item.name}
              <span className="ml-2 text-muted-foreground">/{item.slug}</span>
              {!item.isActive ? <span className="ml-2 text-amber-300">inactive</span> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function useUnsavedChangesGuard(shouldBlock: boolean) {
  const blocker = useBlocker(shouldBlock);
  useBeforeUnload(
    (event) => {
      if (!shouldBlock) return;
      event.preventDefault();
      event.returnValue = '';
    },
    { capture: true }
  );
  return blocker;
}

function PromotionTrustSections(props: { promotion: PromotionDetail }) {
  const { promotion } = props;

  return (
    <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
      <div className="space-y-4">
        <SectionCard title="Overview" subtitle="Readable commercial summary for operators validating what this promo actually does.">
          <div className="divide-y divide-white/10">
            <DetailRow label="Code" value={promotion.code} />
            <DetailRow label="Title" value={promotion.title ?? '—'} />
            <DetailRow label="Type" value={promotion.type} />
            <DetailRow label="Discount" value={promotion.type === 'PERCENT' ? `${promotion.value}% off` : formatMoney(promotion.value)} />
            <DetailRow label="Schedule" value={formatDateRange(promotion.startAt, promotion.endAt)} />
            <DetailRow label="Usage Count" value={promotion.usageSummary.totalRedemptions} />
            <DetailRow label="Usage Limit" value={promotion.usageSummary.totalLimit ?? 'Unlimited'} />
            <DetailRow label="Active State" value={promotion.isActive ? 'Active' : 'Inactive'} />
          </div>
        </SectionCard>

        <SectionCard title="Eligibility Summary" subtitle="Who can use it, when it applies, and which catalog restrictions are active.">
          <div className="space-y-4">
            <SummaryList
              items={[
                promotion.eligibilitySummary.whoCanUseIt,
                promotion.eligibilitySummary.whenItApplies,
                promotion.eligibilitySummary.minOrderAmount,
                ...promotion.eligibilitySummary.capExclusionsLimits
              ]}
              emptyLabel="No eligibility rules configured."
            />
            <div className="grid gap-4 lg:grid-cols-3">
              <EntityPills title="Categories" items={promotion.eligibilitySummary.categories} />
              <EntityPills title="Brands" items={promotion.eligibilitySummary.brands} />
              <EntityPills title="Products" items={promotion.eligibilitySummary.products} />
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Validation" subtitle="What is currently blocking this promo and why it may fail during checkout.">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant={validityVariant(promotion.validation.liveValidityStatus)}>{promotion.validation.liveValidityStatus.toUpperCase()}</Badge>
              {promotion.isExhausted ? <Badge variant="warning">EXHAUSTED</Badge> : null}
            </div>
            {promotion.validation.invalidConfiguration ? (
              <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-100">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <div className="font-medium">Invalid configuration detected</div>
                    <div className="mt-1 text-rose-100/90">This promotion needs correction before operators can trust it at checkout.</div>
                  </div>
                </div>
              </div>
            ) : null}
            {!promotion.validation.invalidConfiguration && promotion.validation.liveValidityStatus === 'live' ? (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>This promo is live now. Cart-specific eligibility can still block it, but the rule itself is currently valid.</span>
                </div>
              </div>
            ) : null}
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <div className="mb-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">Warnings</div>
                <SummaryList items={promotion.validation.warnings} emptyLabel="No operator warnings." />
              </div>
              <div>
                <div className="mb-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">Why this may fail at checkout</div>
                <SummaryList items={promotion.validation.checkoutHints} emptyLabel="No checkout failure hints." />
              </div>
            </div>
            {promotion.validation.invalidReasons.length ? (
              <div>
                <div className="mb-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">Invalid reasons</div>
                <SummaryList items={promotion.validation.invalidReasons} emptyLabel="No invalid reasons." />
              </div>
            ) : null}
          </div>
        </SectionCard>
      </div>

      <div className="space-y-4">
        <SectionCard title="Usage" subtitle="Usage pressure and exhaustion state for support/debugging.">
          <div className="divide-y divide-white/10">
            <DetailRow label="Total Redemptions" value={promotion.usageSummary.totalRedemptions} />
            <DetailRow label="Remaining Uses" value={promotion.usageSummary.remainingUses ?? 'Unlimited'} />
            <DetailRow label="Per-user Cap" value={promotion.usageSummary.perUserLimit ?? 'No cap'} />
            <DetailRow label="Total Limit" value={promotion.usageSummary.totalLimit ?? 'No cap'} />
            <DetailRow label="Exhausted" value={promotion.usageSummary.isExhausted ? 'Yes' : 'No'} />
          </div>
          {promotion.usageSummary.exhaustedStateLabel ? (
            <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
              <div className="flex items-start gap-2">
                <Clock3 className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{promotion.usageSummary.exhaustedStateLabel}</span>
              </div>
            </div>
          ) : null}
        </SectionCard>

        <SectionCard title="Linked Business Rules" subtitle="Direct rule surface that operators need when answering support questions.">
          <div className="divide-y divide-white/10">
            <DetailRow label="Minimum Order" value={promotion.linkedBusinessRules.minSubtotal != null ? formatMoney(promotion.linkedBusinessRules.minSubtotal) : 'None'} />
            <DetailRow label="Max Discount Cap" value={promotion.linkedBusinessRules.maxDiscount != null ? formatMoney(promotion.linkedBusinessRules.maxDiscount) : 'None'} />
            <DetailRow label="Exclude Discounted Items" value={promotion.linkedBusinessRules.excludeDiscountedItems ? 'Yes' : 'No'} />
            <DetailRow label="Category Restrictions" value={promotion.linkedBusinessRules.eligibleCategories.length || 'None'} />
            <DetailRow label="Brand Restrictions" value={promotion.linkedBusinessRules.eligibleBrands.length || 'None'} />
            <DetailRow label="Product Restrictions" value={promotion.linkedBusinessRules.eligibleProducts.length || 'None'} />
          </div>
          <div className="mt-4 space-y-3">
            <EntityPills title="Eligible Categories" items={promotion.linkedBusinessRules.eligibleCategories} />
            <EntityPills title="Eligible Brands" items={promotion.linkedBusinessRules.eligibleBrands} />
            <EntityPills title="Eligible Products" items={promotion.linkedBusinessRules.eligibleProducts} />
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

export function PromotionEditorPage(props: { mode: 'create' | 'edit' }) {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useCapabilities();
  const canManage = can('promotions_manage');
  const [actionError, setActionError] = useState<ApiErrorShape | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);

  const detailQuery = useQuery({
    queryKey: ['admin', 'promotions', 'detail', id],
    queryFn: () => adminGetPromotion(String(id)),
    enabled: props.mode === 'edit' && Boolean(id)
  });

  const form = useForm<PromotionFormValues>({
    resolver: zodResolver(schema) as unknown as Resolver<PromotionFormValues>,
    defaultValues: detailToFormValues()
  });

  useEffect(() => {
    if (props.mode === 'edit' && detailQuery.data) {
      form.reset(detailToFormValues(detailQuery.data), { keepDirty: false });
    }
  }, [detailQuery.data, form, props.mode]);

  const watched = useWatch({ control: form.control });

  const categoriesQuery = useQuery({
    queryKey: ['admin', 'promotions', 'categories'],
    queryFn: () => adminListCategories({ page: 1, limit: 100, isActive: 'all' }),
    enabled: canManage
  });
  const brandsQuery = useQuery({
    queryKey: ['admin', 'promotions', 'brands'],
    queryFn: () => adminListBrands({ page: 1, limit: 100, isActive: 'all' }),
    enabled: canManage
  });
  const productsQuery = useQuery({
    queryKey: ['admin', 'promotions', 'products'],
    queryFn: () => adminListProducts({ page: 1, limit: 100, isActive: 'all', sort: 'updatedAt_desc' }),
    enabled: canManage
  });

  const saveMutation = useMutation({
    mutationFn: async (values: PromotionFormValues) => {
      const payload = buildPayload(values);
      return props.mode === 'create' ? adminCreatePromotion(payload) : adminUpdatePromotion(String(id), payload);
    },
    onMutate: () => setActionError(null),
    onSuccess: async (result) => {
      toast.success(props.mode === 'create' ? 'Promotion created' : 'Promotion updated');
      setReviewOpen(false);
      form.reset(detailToFormValues(result), { keepDirty: false });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'promotions'] });
      if (props.mode === 'create') navigate(`/promotions/${result.id}`);
      else await detailQuery.refetch();
    },
    onError: (error) => setActionError(normalizeApiError(error))
  });

  const deactivateMutation = useMutation({
    mutationFn: async () => adminDeactivatePromotion(String(id)),
    onMutate: () => setActionError(null),
    onSuccess: async (result) => {
      toast.success('Promotion deactivated');
      setDeactivateOpen(false);
      form.reset(detailToFormValues(result), { keepDirty: false });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'promotions'] }),
        detailQuery.refetch()
      ]);
    },
    onError: (error) => setActionError(normalizeApiError(error))
  });

  const isDirty = form.formState.isDirty && !saveMutation.isPending;
  const blocker = useUnsavedChangesGuard(isDirty);

  const reviewSummary = useMemo(() => {
    const summary: string[] = [];
    if (watched.type === 'PERCENT') summary.push(`${Math.trunc(Number(watched.value ?? 0))}% off`);
    else summary.push(`${formatMoney(Number(watched.value ?? 0))} off`);
    if (watched.minSubtotal) summary.push(`min order ${formatMoney(Number(watched.minSubtotal))}`);
    if (watched.maxDiscount) summary.push(`max discount ${formatMoney(Number(watched.maxDiscount))}`);
    summary.push(`valid ${formatDate(watched.startAt ? new Date(watched.startAt).toISOString() : '')} → ${formatDate(watched.endAt ? new Date(watched.endAt).toISOString() : '')}`);
    if (watched.usageLimitTotal) summary.push(`usage limit ${watched.usageLimitTotal}`);
    if (watched.usageLimitPerUser) summary.push(`per-user limit ${watched.usageLimitPerUser}`);
    if (watched.eligibleCategoryIds?.length) summary.push(`${watched.eligibleCategoryIds.length} eligible categories`);
    if (watched.eligibleBrandIds?.length) summary.push(`${watched.eligibleBrandIds.length} eligible brands`);
    if (watched.eligibleProductIds?.length) summary.push(`${watched.eligibleProductIds.length} eligible products`);
    if (watched.excludeDiscountedItems) summary.push('excludes already discounted items');
    if (watched.isActive === 'false') summary.push('inactive until manually enabled');
    return summary;
  }, [watched]);

  const currentPromotion = detailQuery.data;
  const readOnly = !canManage && props.mode === 'edit';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="secondary" size="sm" asChild>
          <Link to={`/promotions${location.search}`}>Back</Link>
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          {props.mode === 'edit' ? (
            <Button variant="secondary" size="sm" onClick={() => detailQuery.refetch()} disabled={detailQuery.isFetching}>
              <RefreshCw className={`mr-2 h-4 w-4 ${detailQuery.isFetching ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          ) : null}
          {props.mode === 'edit' && canManage && currentPromotion?.isActive ? (
            <Button variant="destructive" size="sm" onClick={() => setDeactivateOpen(true)}>
              Deactivate
            </Button>
          ) : null}
          {canManage ? (
            <>
              <Button variant="secondary" size="sm" onClick={() => form.reset(detailToFormValues(currentPromotion), { keepDirty: false })} disabled={!isDirty}>
                Reset changes
              </Button>
              <Button size="sm" onClick={form.handleSubmit(() => setReviewOpen(true))} disabled={saveMutation.isPending}>
                Review & save
              </Button>
            </>
          ) : (
            <Badge>Read-only</Badge>
          )}
        </div>
      </div>

      {actionError ? <ErrorState error={actionError} onRetry={() => props.mode === 'edit' ? detailQuery.refetch() : undefined} /> : null}
      {detailQuery.isError ? <ErrorState error={normalizeApiError(detailQuery.error)} onRetry={() => detailQuery.refetch()} /> : null}

      {props.mode === 'edit' && detailQuery.isLoading ? (
        <Card className="p-6">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="mt-4 h-40 w-full" />
        </Card>
      ) : null}

      {(props.mode === 'create' || currentPromotion) && !detailQuery.isLoading ? (
        <>
          <Card className="p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">{props.mode === 'create' ? 'New Promotion' : 'Promotion'}</div>
                <div className="mt-2 text-2xl font-semibold">{currentPromotion?.title ?? watched.title ?? 'Untitled promotion'}</div>
                <div className="mt-1 text-sm text-muted-foreground">{currentPromotion?.code ?? watched.code?.toUpperCase() ?? 'Code not set yet'}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant={currentPromotion ? statusVariant(currentPromotion.status) : 'default'}>{currentPromotion?.status ?? 'new'}</Badge>
                <Badge>{watched.type ?? currentPromotion?.type ?? 'PERCENT'}</Badge>
                {currentPromotion ? <Badge variant={validityVariant(currentPromotion.validation.liveValidityStatus)}>{currentPromotion.validation.liveValidityStatus.toUpperCase()}</Badge> : null}
                {currentPromotion?.isExhausted ? <Badge variant="warning">EXHAUSTED</Badge> : null}
              </div>
            </div>
            <div className="mt-4 grid gap-3 text-xs text-muted-foreground md:grid-cols-2">
              <div>Created: {formatDate(currentPromotion?.createdAt)}</div>
              <div>Updated: {formatDate(currentPromotion?.updatedAt)}</div>
            </div>
          </Card>

          {props.mode === 'edit' && currentPromotion ? <PromotionTrustSections promotion={currentPromotion} /> : null}

          <form className="space-y-4" onSubmit={(event) => event.preventDefault()}>
            <Card className="p-5">
              <div className="text-sm font-semibold">Core fields</div>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="promo-code">Code</Label>
                  <Input id="promo-code" placeholder="e.g. LAUNCH10" disabled={readOnly} {...form.register('code')} />
                  {form.formState.errors.code ? <div className="text-xs text-destructive">{form.formState.errors.code.message}</div> : null}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="promo-title">Internal / display title</Label>
                  <Input id="promo-title" placeholder="e.g. Launch Weekend 10% Off" disabled={readOnly} {...form.register('title')} />
                  {form.formState.errors.title ? <div className="text-xs text-destructive">{form.formState.errors.title.message}</div> : null}
                </div>
                <div className="grid gap-2 md:col-span-2">
                  <Label htmlFor="promo-description">Description / notes</Label>
                  <Textarea id="promo-description" rows={4} placeholder="Optional operator note for what this promo is meant to do" disabled={readOnly} {...form.register('description')} />
                </div>
                <div className="grid gap-2">
                  <Label>Promo type</Label>
                  <Select value={watched.type} disabled={readOnly} onValueChange={(value) => form.setValue('type', value as PromotionFormValues['type'], { shouldDirty: true, shouldValidate: true })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PERCENT">Percent</SelectItem>
                      <SelectItem value="FLAT">Flat amount</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="promo-value">Discount value</Label>
                  <Input id="promo-value" type="number" min={1} step={1} disabled={readOnly} {...form.register('value')} />
                  {form.formState.errors.value ? <div className="text-xs text-destructive">{form.formState.errors.value.message}</div> : null}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="promo-min-subtotal">Min order amount</Label>
                  <Input id="promo-min-subtotal" type="number" min={0} step={1} disabled={readOnly} {...form.register('minSubtotal')} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="promo-max-discount">Max discount cap</Label>
                  <Input id="promo-max-discount" type="number" min={0} step={1} disabled={readOnly} {...form.register('maxDiscount')} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="promo-usage-total">Usage limit</Label>
                  <Input id="promo-usage-total" type="number" min={0} step={1} disabled={readOnly} {...form.register('usageLimitTotal')} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="promo-usage-user">Per-user limit</Label>
                  <Input id="promo-usage-user" type="number" min={0} step={1} disabled={readOnly} {...form.register('usageLimitPerUser')} />
                </div>
              </div>
            </Card>

            <Card className="p-5">
              <div className="text-sm font-semibold">Eligibility</div>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="promo-start">Active start</Label>
                  <Input id="promo-start" type="datetime-local" disabled={readOnly} {...form.register('startAt')} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="promo-end">Active end</Label>
                  <Input id="promo-end" type="datetime-local" disabled={readOnly} {...form.register('endAt')} />
                  {form.formState.errors.endAt ? <div className="text-xs text-destructive">{form.formState.errors.endAt.message}</div> : null}
                </div>
              </div>
              <div className="mt-4 grid gap-4 xl:grid-cols-3">
                <MultiSelectCard
                  title="Eligible categories"
                  items={(categoriesQuery.data?.items ?? []).map((item) => ({ id: item.id, label: item.name, description: item.slug }))}
                  values={watched.eligibleCategoryIds ?? []}
                  disabled={readOnly || categoriesQuery.isLoading}
                  onToggle={(value) => form.setValue('eligibleCategoryIds', toggleArrayValue(watched.eligibleCategoryIds ?? [], value), { shouldDirty: true })}
                />
                <MultiSelectCard
                  title="Eligible brands"
                  items={(brandsQuery.data?.items ?? []).map((item) => ({ id: item.id, label: item.name, description: item.slug }))}
                  values={watched.eligibleBrandIds ?? []}
                  disabled={readOnly || brandsQuery.isLoading}
                  onToggle={(value) => form.setValue('eligibleBrandIds', toggleArrayValue(watched.eligibleBrandIds ?? [], value), { shouldDirty: true })}
                />
                <MultiSelectCard
                  title="Eligible products"
                  items={(productsQuery.data?.items ?? []).map((item) => ({ id: item.id, label: item.name, description: item.slug }))}
                  values={watched.eligibleProductIds ?? []}
                  disabled={readOnly || productsQuery.isLoading}
                  onToggle={(value) => form.setValue('eligibleProductIds', toggleArrayValue(watched.eligibleProductIds ?? [], value), { shouldDirty: true })}
                />
              </div>
            </Card>

            <Card className="p-5">
              <div className="text-sm font-semibold">Activation</div>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Active state</Label>
                  <Select value={watched.isActive} disabled={readOnly} onValueChange={(value) => form.setValue('isActive', value as 'true' | 'false', { shouldDirty: true })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="true">Active</SelectItem>
                      <SelectItem value="false">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Schedule summary</div>
                  <div className="mt-2 text-sm">{reviewSummary.find((line) => line.startsWith('valid ')) ?? 'Set a valid active window.'}</div>
                </div>
              </div>
              <div className="mt-4 rounded-xl border border-border/70 bg-muted/30 p-4">
                <label className={`flex items-start gap-3 ${readOnly ? 'opacity-70' : ''}`}>
                  <input type="checkbox" className="mt-1 h-4 w-4 accent-[hsl(var(--primary))]" checked={watched.excludeDiscountedItems ?? false} disabled={readOnly} onChange={(event) => form.setValue('excludeDiscountedItems', event.currentTarget.checked, { shouldDirty: true })} />
                  <div>
                    <div className="text-sm font-medium">Exclude discounted items</div>
                    <div className="mt-1 text-xs text-muted-foreground">Prevents this promotion from applying to catalog items already priced below MRP.</div>
                  </div>
                </label>
              </div>
              <div className="mt-4 space-y-2">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Validation warnings</div>
                {watched.type === 'PERCENT' && Number(watched.value ?? 0) > 100 ? <div className="text-sm text-destructive">Percentage discounts cannot exceed 100%.</div> : null}
                {watched.endAt && watched.startAt && new Date(watched.startAt).getTime() >= new Date(watched.endAt).getTime() ? <div className="text-sm text-destructive">End time must be after start time.</div> : null}
                {watched.isActive === 'false' ? <div className="text-sm text-muted-foreground">This promotion will save as inactive and will not apply until re-enabled.</div> : null}
              </div>
            </Card>

            <Card className="p-5">
              <div className="text-sm font-semibold">Validation preview</div>
              <div className="mt-4 grid gap-2">
                {reviewSummary.map((line) => (
                  <div key={line} className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-sm">
                    {line}
                  </div>
                ))}
              </div>
            </Card>
          </form>
        </>
      ) : null}

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review promotion before saving</DialogTitle>
            <DialogDescription>No silent save. Confirm the rule summary and schedule before applying changes.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {reviewSummary.map((line) => (
              <div key={line} className="rounded-md border p-3 text-sm">
                {line}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setReviewOpen(false)}>
              Back
            </Button>
            <Button disabled={saveMutation.isPending} onClick={form.handleSubmit((values) => saveMutation.mutate(values))}>
              {saveMutation.isPending ? <Skeleton className="mr-2 h-4 w-4 rounded-full" /> : null}
              Save promotion
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={blocker.state === 'blocked'}
        onOpenChange={(open) => {
          if (!open && blocker.state === 'blocked' && blocker.reset) blocker.reset();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Leave without saving?</DialogTitle>
            <DialogDescription>You have unsaved promotion changes. Leaving now will discard them.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                if (blocker.reset) blocker.reset();
              }}
            >
              Stay here
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (blocker.proceed) blocker.proceed();
              }}
            >
              Leave page
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deactivateOpen} onOpenChange={setDeactivateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deactivate this promotion?</DialogTitle>
            <DialogDescription>{currentPromotion ? `${currentPromotion.code} will stop applying to future validations and orders.` : 'This promotion will be deactivated.'}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeactivateOpen(false)}>
              Keep active
            </Button>
            <Button variant="destructive" disabled={deactivateMutation.isPending} onClick={() => deactivateMutation.mutate()}>
              {deactivateMutation.isPending ? <LoaderIcon /> : null}
              Deactivate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LoaderIcon() {
  return <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />;
}
