import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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
import { useCapabilities } from '../../../lib/permissions/useCapabilities.js';
import { normalizeApiError } from '../../../lib/api/normalizeError.js';
import { adminCreateBrand, adminDeactivateBrand, adminListBrands, adminUpdateBrand } from './brands.api.js';
import type { BrandAdminRow, CloudinaryAsset, UpdateBrandRequest } from './brands.types.js';
import { BrandUpsertDialog } from './BrandUpsertDialog.js';
import { adminDestroyImage, adminUploadImage } from '../uploads/uploads.api.js';
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

export function BrandsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();

  const { can } = useCapabilities();
  const uploadsAllowed = can('uploads');

  const q = (searchParams.get('q') ?? '').trim() || undefined;
  const isActive = ((searchParams.get('isActive') ?? 'all').trim() || 'all') as 'active' | 'inactive' | 'all';
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const limitRaw = Number(searchParams.get('limit') ?? '20') || 20;
  const limit = ([20, 50, 100].includes(limitRaw) ? limitRaw : 20) as 20 | 50 | 100;

  const [upsertOpen, setUpsertOpen] = useState(false);
  const [upsertMode, setUpsertMode] = useState<'create' | 'edit'>('create');
  const [editing, setEditing] = useState<BrandAdminRow | null>(null);

  const queryKey = useMemo(() => ['admin', 'catalog', 'brands', 'list', { q, isActive, page, limit }], [q, isActive, page, limit]);
  const listQuery = useQuery({
    queryKey,
    queryFn: () => adminListBrands({ q, isActive, page, limit })
  });

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

  const createMutation = useMutation({
    mutationFn: adminCreateBrand,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin', 'catalog', 'brands'] });
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateBrandRequest }) => adminUpdateBrand(id, body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin', 'catalog', 'brands'] });
    }
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => adminDeactivateBrand(id),
    onSuccess: async () => {
      toast.success('Brand deactivated');
      await qc.invalidateQueries({ queryKey: ['admin', 'catalog', 'brands'] });
    },
    onError: (e) => {
      const err = normalizeApiError(e);
      if (err.errorCode === 'BRAND_IN_USE') toast.error('Brand is in use by products. Move products first.');
      else toast.error(err.message);
    }
  });

  const data = listQuery.data;

  function openCreate() {
    setEditing(null);
    setUpsertMode('create');
    setUpsertOpen(true);
  }

  function openEdit(row: BrandAdminRow) {
    setEditing(row);
    setUpsertMode('edit');
    setUpsertOpen(true);
  }

  function statusVariant(active: boolean) {
    return active ? ('success' as const) : ('destructive' as const);
  }

  function fmtDate(iso: string) {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }

  async function removeLogo() {
    if (!editing) return;
    await updateMutation.mutateAsync({ id: editing.id, body: { logo: null } });
    toast.success('Logo removed');
    setUpsertOpen(false);
  }

  async function deleteLogo(publicId: string) {
    if (!editing) return;
    await adminDestroyImage(publicId);
    await updateMutation.mutateAsync({ id: editing.id, body: { logo: null } });
    toast.success('Logo deleted');
    setUpsertOpen(false);
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="grid gap-2 md:grid-cols-3">
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
            <Button onClick={openCreate}>Create</Button>
          </div>
        </div>
      </Card>

      {listQuery.isError ? <ErrorState error={normalizeApiError(listQuery.error)} onRetry={() => listQuery.refetch()} /> : null}

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="text-sm font-semibold">Brands</div>
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
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr className="text-left">
                <th className="px-4 py-3 font-medium">Logo</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Slug</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Updated</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {listQuery.isLoading ? (
                <tr>
                  <td className="px-4 py-6 text-muted-foreground" colSpan={6}>
                    Loading…
                  </td>
                </tr>
              ) : null}

              {!listQuery.isLoading && data?.items?.length === 0 ? (
                <tr>
                  <td className="px-4 py-8 text-muted-foreground" colSpan={6}>
                    No brands found.
                  </td>
                </tr>
              ) : null}

              {data?.items?.map((b) => (
                <tr key={b.id} className="border-t">
                  <td className="px-4 py-3">
                    <div className="h-9 w-9 overflow-hidden rounded-md border bg-muted/30">
                      {b.logo?.url ? <img src={b.logo.url} alt={`${b.name} logo`} className="h-full w-full object-cover" /> : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-medium">{b.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{b.slug}</td>
                  <td className="px-4 py-3">
                    <Badge variant={statusVariant(b.isActive)}>{b.isActive ? 'ACTIVE' : 'INACTIVE'}</Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{fmtDate(b.updatedAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="secondary">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(b)}>Edit</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive">
                              Deactivate
                            </DropdownMenuItem>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Deactivate brand?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This hides the brand from public browse. If any product references this brand, the backend will block this action.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel asChild>
                                <Button variant="secondary">Cancel</Button>
                              </AlertDialogCancel>
                              <AlertDialogAction asChild>
                                <Button
                                  variant="destructive"
                                  onClick={() => deactivateMutation.mutate(b.id)}
                                  disabled={deactivateMutation.isPending}
                                >
                                  Deactivate
                                </Button>
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground">
          <div>
            {data ? (
              <>
                Showing {(data.page - 1) * data.limit + 1}–{Math.min(data.page * data.limit, data.total)} of {data.total}
              </>
            ) : (
              '—'
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1 || listQuery.isLoading}
              onClick={() => setParam({ page: String(Math.max(1, page - 1)) })}
            >
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

      <BrandUpsertDialog
        open={upsertOpen}
        mode={upsertMode}
        initial={editing}
        uploadsAllowed={uploadsAllowed}
        onOpenChange={setUpsertOpen}
        onRemoveLogo={uploadsAllowed ? removeLogo : undefined}
        onDeleteLogo={uploadsAllowed ? deleteLogo : undefined}
        onSubmit={async ({ values, file }) => {
          if (upsertMode === 'create') {
            const created = await createMutation.mutateAsync(values);
            if (file && uploadsAllowed) {
              let asset: CloudinaryAsset | undefined;
              try {
                asset = await adminUploadImage({ file, target: 'brands', targetId: created._id });
                await updateMutation.mutateAsync({ id: created._id, body: { logo: asset } });
              } catch (e) {
                if (asset?.publicId) {
                  try {
                    await adminDestroyImage(asset.publicId);
                  } catch {
                    // best-effort cleanup
                  }
                }
                toast.error(`Brand created, but logo upload failed: ${normalizeApiError(e).message}`);
              }
            }
            return;
          }

          if (!editing) {
            toast.error('Missing brand to edit');
            return;
          }

          const body: UpdateBrandRequest = values;
          if (file && uploadsAllowed) {
            const asset = await adminUploadImage({ file, target: 'brands', targetId: editing.id });
            body.logo = asset;
            try {
              await updateMutation.mutateAsync({ id: editing.id, body });
            } catch (e) {
              if (asset?.publicId) {
                try {
                  await adminDestroyImage(asset.publicId);
                } catch {
                  // best-effort cleanup
                }
              }
              throw e;
            }
            return;
          }
          await updateMutation.mutateAsync({ id: editing.id, body });
        }}
      />
    </div>
  );
}
