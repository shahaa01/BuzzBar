import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Plus } from 'lucide-react';
import { useMemo } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ErrorState } from '../../../components/feedback/ErrorState.js';
import { Badge } from '../../../components/ui/badge.js';
import { Button } from '../../../components/ui/button.js';
import { Card } from '../../../components/ui/card.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '../../../components/ui/dropdown-menu.js';
import { Input } from '../../../components/ui/input.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select.js';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '../../../components/ui/alert-dialog.js';
import { normalizeApiError } from '../../../lib/api/normalizeError.js';
import { useCapabilities } from '../../../lib/permissions/useCapabilities.js';
import { adminListBrands } from '../brands/brands.api.js';
import { adminListCategories } from '../categories/categories.api.js';
import { adminDeactivateProduct, adminListProducts } from './products.api.js';
import type { ProductStockStatus } from './products.types.js';

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function stockBadge(status: ProductStockStatus) {
  if (status === 'out_of_stock') return { label: 'OUT', variant: 'destructive' as const };
  if (status === 'low_stock') return { label: 'LOW', variant: 'warning' as const };
  return { label: 'IN STOCK', variant: 'success' as const };
}

export function CatalogProductsPage() {
  const { can } = useCapabilities();
  const canManage = can('catalog');

  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();

  const q = (searchParams.get('q') ?? '').trim() || undefined;
  const isActive = ((searchParams.get('isActive') ?? searchParams.get('status') ?? 'all').trim() || 'all') as 'active' | 'inactive' | 'all';
  const brandId = (searchParams.get('brandId') ?? '').trim() || undefined;
  const categoryId = (searchParams.get('categoryId') ?? '').trim() || undefined;
  const sort = ((searchParams.get('sort') ?? 'updatedAt_desc').trim() || 'updatedAt_desc') as
    | 'updatedAt_desc'
    | 'updatedAt_asc'
    | 'createdAt_desc'
    | 'createdAt_asc'
    | 'name_asc'
    | 'name_desc'
    | 'stockStatus_asc'
    | 'stockStatus_desc';
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const limitRaw = Number(searchParams.get('limit') ?? '20') || 20;
  const limit = ([20, 50, 100].includes(limitRaw) ? limitRaw : 20) as 20 | 50 | 100;

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
    queryKey: useMemo(
      () => ['admin', 'catalog', 'products', 'list', { q, isActive, brandId, categoryId, sort, page, limit }],
      [q, isActive, brandId, categoryId, sort, page, limit]
    ),
    queryFn: () =>
      adminListProducts({
        q,
        brandId: canManage ? brandId : undefined,
        categoryId: canManage ? categoryId : undefined,
        isActive,
        sort,
        page,
        limit
      })
  });

  const brandsQuery = useQuery({
    queryKey: ['admin', 'catalog', 'brands', 'forSelect'],
    queryFn: () => adminListBrands({ page: 1, limit: 100, isActive: 'all' as const }),
    enabled: canManage
  });

  const categoriesQuery = useQuery({
    queryKey: ['admin', 'catalog', 'categories', 'forSelect'],
    queryFn: () => adminListCategories({ page: 1, limit: 100, isActive: 'all' as const }),
    enabled: canManage
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => adminDeactivateProduct(id),
    onSuccess: async () => {
      toast.success('Product deactivated');
      await qc.invalidateQueries({ queryKey: ['admin', 'catalog', 'products'] });
    },
    onError: (e) => toast.error(normalizeApiError(e).message)
  });

  const data = listQuery.data;
  const brandOptions = brandsQuery.data?.items ?? [];
  const categoryOptions = categoriesQuery.data?.items ?? [];

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="grid gap-2 md:grid-cols-4">
            <div className="grid gap-1">
              <div className="text-xs text-muted-foreground">Status</div>
              <Select value={isActive} onValueChange={(v) => resetPageAndSet({ isActive: v === 'all' ? undefined : v })}>
                <SelectTrigger className="w-[220px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1">
              <div className="text-xs text-muted-foreground">Search</div>
              <Input
                placeholder="Name or slug…"
                defaultValue={q ?? ''}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const v = (e.currentTarget.value ?? '').trim();
                    resetPageAndSet({ q: v || undefined });
                  }
                }}
              />
            </div>

            <div className="grid gap-1">
              <div className="text-xs text-muted-foreground">Sort</div>
              <Select value={sort} onValueChange={(v) => resetPageAndSet({ sort: v })}>
                <SelectTrigger className="w-[220px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="updatedAt_desc">Updated · newest</SelectItem>
                  <SelectItem value="updatedAt_asc">Updated · oldest</SelectItem>
                  <SelectItem value="name_asc">Name · A–Z</SelectItem>
                  <SelectItem value="name_desc">Name · Z–A</SelectItem>
                  <SelectItem value="createdAt_desc">Created · newest</SelectItem>
                  <SelectItem value="createdAt_asc">Created · oldest</SelectItem>
                  <SelectItem value="stockStatus_asc">Stock · needs attention</SelectItem>
                  <SelectItem value="stockStatus_desc">Stock · healthiest first</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1">
              <div className="text-xs text-muted-foreground">Per page</div>
              <Select value={String(limit)} onValueChange={(v) => resetPageAndSet({ limit: v })}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="20">20 / page</SelectItem>
                  <SelectItem value="50">50 / page</SelectItem>
                  <SelectItem value="100">100 / page</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setSearchParams(new URLSearchParams(), { replace: true })}>
              Reset
            </Button>
            {canManage ? (
              <Button onClick={() => navigate(`/catalog/products/new${location.search}`)}>
                <Plus className="mr-2 h-4 w-4" />
                New product
              </Button>
            ) : null}
          </div>
        </div>

        {canManage ? (
          <div className="mt-4 grid gap-2 md:grid-cols-2">
            <div className="grid gap-1">
              <div className="text-xs text-muted-foreground">Brand</div>
              <Select value={brandId ?? 'all'} onValueChange={(v) => resetPageAndSet({ brandId: v === 'all' ? undefined : v })}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="All brands" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All brands</SelectItem>
                  {brandOptions.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name} {b.isActive ? '' : '(inactive)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <div className="text-xs text-muted-foreground">Category</div>
              <Select
                value={categoryId ?? 'all'}
                onValueChange={(v) => resetPageAndSet({ categoryId: v === 'all' ? undefined : v })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="All categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {categoryOptions.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} {c.isActive ? '' : '(inactive)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : null}
      </Card>

      {listQuery.isError ? <ErrorState error={normalizeApiError(listQuery.error)} onRetry={() => listQuery.refetch()} /> : null}

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="text-sm font-semibold">Products</div>
          <div className="text-xs text-muted-foreground">
            {data ? (
              <>
                {data.total} total · page {data.page}
              </>
            ) : (
              '—'
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Image</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Brand</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Stock</th>
                <th className="px-4 py-3 font-medium">Updated</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {listQuery.isLoading ? (
                <tr>
                  <td className="px-4 py-6 text-muted-foreground" colSpan={8}>
                    Loading…
                  </td>
                </tr>
              ) : null}

              {!listQuery.isLoading && data?.items?.length === 0 ? (
                <tr>
                  <td className="px-4 py-8 text-muted-foreground" colSpan={8}>
                    No products found.
                  </td>
                </tr>
              ) : null}

              {data?.items?.map((p) => {
                const stock = stockBadge(p.stockStatus);
                return (
                  <tr key={p.id} className="border-t">
                    <td className="px-4 py-3">
                      <div className="h-10 w-10 overflow-hidden rounded-md border bg-muted/30">
                        {p.primaryImage?.url ? (
                          <img src={p.primaryImage.url} alt={`${p.name} image`} className="h-full w-full object-cover" />
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{p.name}</div>
                      <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{p.slug}</div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{p.brand?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground">{p.category?.name ?? '—'}</td>
                    <td className="px-4 py-3">
                      <Badge variant={p.isActive ? 'success' : 'destructive'}>{p.isActive ? 'ACTIVE' : 'INACTIVE'}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={stock.variant}>{stock.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{fmtDate(p.updatedAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" variant="secondary">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => navigate(`/catalog/products/${p.id}${location.search}`)}>
                            {canManage ? 'View / Edit' : 'View'}
                          </DropdownMenuItem>
                          {canManage ? (
                            <>
                              <DropdownMenuSeparator />
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={(e) => e.preventDefault()}>
                                    Deactivate
                                  </DropdownMenuItem>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Deactivate product?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      This sets the product to inactive and automatically deactivates its variants. Inventory is not changed.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => deactivateMutation.mutate(p.id)}>Deactivate</AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground">
          <div>{data ? `Page ${data.page} · ${data.total} total` : '—'}</div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" disabled={page <= 1 || listQuery.isLoading} onClick={() => setParam({ page: String(page - 1) })}>
              Prev
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={listQuery.isLoading || !data || data.page * data.limit >= data.total}
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
