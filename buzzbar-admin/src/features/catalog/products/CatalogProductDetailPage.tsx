import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { MoreHorizontal, Upload, Plus, ExternalLink, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';
import { ErrorState } from '../../../components/feedback/ErrorState.js';
import { Badge } from '../../../components/ui/badge.js';
import { Button } from '../../../components/ui/button.js';
import { Card } from '../../../components/ui/card.js';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '../../../components/ui/dropdown-menu.js';
import { Input } from '../../../components/ui/input.js';
import { Label } from '../../../components/ui/label.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select.js';
import { Textarea } from '../../../components/ui/textarea.js';
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
import { slugify } from '../../../lib/utils/slugify.js';
import { useCapabilities } from '../../../lib/permissions/useCapabilities.js';
import { adminListBrands } from '../brands/brands.api.js';
import { adminListCategories } from '../categories/categories.api.js';
import { adminDestroyImage, adminUploadImage } from '../uploads/uploads.api.js';
import { adminCreateVariant, adminDeactivateProduct, adminDeactivateVariant, adminGetProduct, adminUpdateProduct, adminUpdateVariant } from './products.api.js';
import type { CloudinaryAsset } from '../brands/brands.types.js';
import type { CreateVariantRequest, ProductVariantRow, UpdateProductRequest, UpdateVariantRequest } from './products.types.js';
import type React from 'react';

const MAX_FILE_SIZE_BYTES = 7 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function SortableImage(props: {
  image: CloudinaryAsset;
  disabled: boolean;
  onRemove: () => void;
  onDeleteCloudinary?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.image.publicId, disabled: props.disabled });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.75 : 1
  };

  return (
    <div ref={setNodeRef} style={style} className="group relative overflow-hidden rounded-lg border bg-muted/20">
      <div
        className="aspect-square w-full select-none bg-muted/30"
        {...attributes}
        {...listeners}
        title={props.disabled ? undefined : 'Drag to reorder'}
      >
        <img src={props.image.url} alt="Product" className="h-full w-full object-cover" />
      </div>

      <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="secondary" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={props.onRemove} disabled={props.disabled}>
              Remove from product
            </DropdownMenuItem>
            {props.onDeleteCloudinary ? (
              <>
                <DropdownMenuSeparator />
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={(e) => e.preventDefault()} disabled={props.disabled}>
                      Delete from Cloudinary
                    </DropdownMenuItem>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete image from Cloudinary?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This permanently deletes the asset. This action is intentionally explicit.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={props.onDeleteCloudinary} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

const productSchema = z.object({
  name: z.string().min(1, 'Name is required').max(140),
  slug: z.string().min(1, 'Slug is required').max(140),
  brandId: z.string().min(1, 'Brand is required'),
  categoryId: z.string().min(1, 'Category is required'),
  countryOfOrigin: z.string().max(120).optional(),
  productType: z.string().max(120).optional(),
  subcategory: z.string().max(120).optional(),
  ingredients: z.string().optional(),
  servingSuggestion: z.string().max(500).optional(),
  agingInfo: z.string().max(240).optional(),
  authenticityNote: z.string().max(500).optional(),
  shortDescription: z.string().max(240).optional(),
  tags: z.string().optional(),
  abv: z.string().optional(),
  description: z.string().optional(),
  isActive: z.enum(['true', 'false'])
});

type ProductValues = z.infer<typeof productSchema>;

const variantSchema = z
  .object({
    sku: z.string().min(1, 'SKU is required').max(120),
    label: z.string().max(120).optional(),
    volumeMl: z.number().int().min(1, 'Volume must be > 0'),
    packSize: z.number().int().min(1),
    price: z.number().int().min(0),
    mrp: z.string().optional(),
    isActive: z.enum(['true', 'false'])
  })
  .superRefine((v, ctx) => {
    const mrpStr = (v.mrp ?? '').trim();
    if (!mrpStr) return;
    const mrp = Number(mrpStr);
    if (Number.isNaN(mrp) || mrp < 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['mrp'], message: 'MRP must be a non-negative number' });
      return;
    }
    if (v.price > mrp) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['price'], message: 'Price must be <= MRP' });
  });

type VariantValues = z.infer<typeof variantSchema>;

function VariantDialog(props: {
  open: boolean;
  mode: 'create' | 'edit';
  productIsActive: boolean;
  initial?: ProductVariantRow | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: { sku: string; label?: string; volumeMl: number; packSize: number; price: number; mrp?: number; isActive: boolean }) => Promise<void>;
}) {
  const defaultValues = useMemo(() => {
    if (props.mode === 'edit' && props.initial) {
      return {
        sku: props.initial.sku,
        label: props.initial.label ?? '',
        volumeMl: props.initial.volumeMl,
        packSize: props.initial.packSize,
        price: props.initial.price,
        mrp: props.initial.mrp !== undefined ? String(props.initial.mrp) : '',
        isActive: props.initial.isActive ? 'true' : 'false'
      } satisfies VariantValues;
    }
    return { sku: '', label: '', volumeMl: 750, packSize: 1, price: 0, mrp: '', isActive: 'true' } satisfies VariantValues;
  }, [props.initial, props.mode]);

  const form = useForm<VariantValues>({ resolver: zodResolver(variantSchema), defaultValues });
  const isActive = useWatch({ control: form.control, name: 'isActive' });

  useEffect(() => {
    if (!props.open) return;
    form.reset(defaultValues);
  }, [defaultValues, form, props.open]);

  async function submit(values: VariantValues) {
    const mrpStr = (values.mrp ?? '').trim();
    const mrp = mrpStr ? Number(mrpStr) : undefined;
    await props.onSubmit({
      sku: values.sku.trim(),
      label: values.label?.trim() || undefined,
      volumeMl: values.volumeMl,
      packSize: values.packSize,
      price: values.price,
      mrp,
      isActive: props.productIsActive ? values.isActive === 'true' : false
    });
    toast.success(props.mode === 'create' ? 'Variant created' : 'Variant updated');
    props.onOpenChange(false);
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle>{props.mode === 'create' ? 'Add variant' : 'Edit variant'}</DialogTitle>
          <DialogDescription>Variants are sellable units. SKU must be unique.</DialogDescription>
        </DialogHeader>

        <form className="grid gap-4" onSubmit={form.handleSubmit(submit)}>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="sku">SKU</Label>
              <Input id="sku" placeholder="e.g. OLD-MONK-750" {...form.register('sku')} />
              {form.formState.errors.sku ? <div className="text-xs text-destructive">{form.formState.errors.sku.message}</div> : null}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="label">Label (optional)</Label>
              <Input id="label" placeholder="e.g. 700ML" {...form.register('label')} />
              {form.formState.errors.label ? <div className="text-xs text-destructive">{form.formState.errors.label.message}</div> : null}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-2">
              <Label>Status</Label>
              <Select
                value={isActive}
                onValueChange={(v) => form.setValue('isActive', v as VariantValues['isActive'], { shouldDirty: true })}
                disabled={!props.productIsActive}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">Active</SelectItem>
                  <SelectItem value="false">Inactive</SelectItem>
                </SelectContent>
              </Select>
              {!props.productIsActive ? <div className="text-[11px] text-muted-foreground">Product is inactive — variants cannot be active.</div> : null}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <div className="grid gap-2">
              <Label htmlFor="volumeMl">Volume (ml)</Label>
              <Input id="volumeMl" inputMode="numeric" {...form.register('volumeMl', { valueAsNumber: true })} />
              {form.formState.errors.volumeMl ? <div className="text-xs text-destructive">{form.formState.errors.volumeMl.message}</div> : null}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="packSize">Pack size</Label>
              <Input id="packSize" inputMode="numeric" {...form.register('packSize', { valueAsNumber: true })} />
              {form.formState.errors.packSize ? <div className="text-xs text-destructive">{form.formState.errors.packSize.message}</div> : null}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="price">Price</Label>
              <Input id="price" inputMode="numeric" {...form.register('price', { valueAsNumber: true })} />
              {form.formState.errors.price ? <div className="text-xs text-destructive">{form.formState.errors.price.message}</div> : null}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="mrp">MRP (optional)</Label>
              <Input id="mrp" inputMode="numeric" placeholder="e.g. 1200" {...form.register('mrp')} />
              {form.formState.errors.mrp ? <div className="text-xs text-destructive">{form.formState.errors.mrp.message}</div> : null}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => props.onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">{props.mode === 'create' ? 'Add variant' : 'Save changes'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CatalogProductDetailPage() {
  const { id } = useParams();
  const productId = id ?? '';
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();

  const { can } = useCapabilities();
  const canManage = can('catalog');
  const uploadsAllowed = can('uploads');

  const productQuery = useQuery({
    queryKey: ['admin', 'catalog', 'products', 'detail', productId],
    queryFn: () => adminGetProduct(productId),
    enabled: Boolean(productId)
  });

  const brandsQuery = useQuery({
    queryKey: ['admin', 'catalog', 'brands', 'forSelect', 'all'],
    queryFn: () => adminListBrands({ page: 1, limit: 100, isActive: 'all' as const }),
    enabled: canManage
  });

  const categoriesQuery = useQuery({
    queryKey: ['admin', 'catalog', 'categories', 'forSelect', 'all'],
    queryFn: () => adminListCategories({ page: 1, limit: 100, isActive: 'all' as const }),
    enabled: canManage
  });

  const product = productQuery.data?.product;
  const [draftImages, setDraftImages] = useState<CloudinaryAsset[] | null>(null);
  const images = draftImages ?? (product?.images ?? []);
  const imagesDirty = draftImages !== null;

  const defaultValues = useMemo(() => {
    const p = productQuery.data?.product;
    if (!p) {
      return {
        name: '',
        slug: '',
        brandId: '',
        categoryId: '',
        countryOfOrigin: '',
        productType: '',
        subcategory: '',
        ingredients: '',
        servingSuggestion: '',
        agingInfo: '',
        authenticityNote: '',
        shortDescription: '',
        tags: '',
        abv: '',
        description: '',
        isActive: 'true'
      } satisfies ProductValues;
    }
    return {
      name: p.name ?? '',
      slug: p.slug ?? '',
      brandId: p.brandId ?? '',
      categoryId: p.categoryId ?? '',
      countryOfOrigin: p.countryOfOrigin ?? '',
      productType: p.productType ?? '',
      subcategory: p.subcategory ?? '',
      ingredients: (p.ingredients ?? []).join(', '),
      servingSuggestion: p.servingSuggestion ?? '',
      agingInfo: p.agingInfo ?? '',
      authenticityNote: p.authenticityNote ?? '',
      shortDescription: p.shortDescription ?? '',
      tags: (p.tags ?? []).join(', '),
      abv: p.abv !== undefined && p.abv !== null ? String(p.abv) : '',
      description: p.description ?? '',
      isActive: p.isActive ? 'true' : 'false'
    } satisfies ProductValues;
  }, [productQuery.data?.product]);

  const form = useForm<ProductValues>({ resolver: zodResolver(productSchema), defaultValues });
  const productName = useWatch({ control: form.control, name: 'name' });
  const productBrandId = useWatch({ control: form.control, name: 'brandId' });
  const productCategoryId = useWatch({ control: form.control, name: 'categoryId' });
  const productIsActiveValue = useWatch({ control: form.control, name: 'isActive' });
  const slugDirty = Boolean(form.formState.dirtyFields.slug);

  useEffect(() => {
    if (!product) return;
    form.reset(defaultValues);
  }, [defaultValues, form, product]);

  const updateProductMutation = useMutation({
    mutationFn: (body: UpdateProductRequest) => adminUpdateProduct(productId, body),
    onSuccess: async () => {
      toast.success('Product updated');
      await qc.invalidateQueries({ queryKey: ['admin', 'catalog', 'products'] });
      await productQuery.refetch();
    },
    onError: (e) => {
      const err = normalizeApiError(e);
      if (err.errorCode === 'SLUG_ALREADY_EXISTS') toast.error('Slug already exists');
      else toast.error(err.message);
    }
  });

  const deactivateProductMutation = useMutation({
    mutationFn: () => adminDeactivateProduct(productId),
    onSuccess: async () => {
      toast.success('Product deactivated');
      await qc.invalidateQueries({ queryKey: ['admin', 'catalog', 'products'] });
      await productQuery.refetch();
    },
    onError: (e) => toast.error(normalizeApiError(e).message)
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  type UploadQueueItem = {
    id: string;
    file: File;
    progress: number;
    status: 'queued' | 'uploading' | 'uploaded' | 'error';
    asset?: CloudinaryAsset;
  };

  const [uploading, setUploading] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function validateFiles(files: File[]) {
    const valid: File[] = [];
    for (const f of files) {
      if (!ALLOWED_MIME.has(f.type)) {
        toast.error(`Unsupported type for ${f.name}. Use JPG, PNG, or WebP.`);
        continue;
      }
      if (f.size > MAX_FILE_SIZE_BYTES) {
        toast.error(`File too large: ${f.name}. Max size is 7MB.`);
        continue;
      }
      valid.push(f);
    }
    return valid;
  }

  const uploadedAssets = useMemo(
    () => uploadQueue.filter((u) => u.status === 'uploaded' && u.asset).map((u) => u.asset!) as CloudinaryAsset[],
    [uploadQueue]
  );
  const queuedActiveCount = uploadQueue.filter((u) => u.status !== 'error').length;

  async function uploadSingle(item: { id: string; file: File }) {
    try {
      setUploadQueue((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: 'uploading', progress: 0 } : p)));
      const asset = await adminUploadImage({
        file: item.file,
        target: 'products',
        targetId: productId,
        onProgress: (pct) => setUploadQueue((prev) => prev.map((p) => (p.id === item.id ? { ...p, progress: pct } : p)))
      });
      setUploadQueue((prev) => prev.map((p) => (p.id === item.id ? { ...p, progress: 100, status: 'uploaded', asset } : p)));
    } catch (e) {
      setUploadQueue((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: 'error' } : p)));
      toast.error(normalizeApiError(e).message);
    }
  }

  async function uploadSelected(files: File[]) {
    if (!uploadsAllowed) return;
    const remaining = 12 - (images.length + queuedActiveCount);
    if (remaining <= 0) {
      toast.error('Maximum 12 images per product.');
      return;
    }
    const sliced = files.slice(0, remaining);
    if (files.length > remaining) toast.error(`Only ${remaining} more image(s) can be added (max 12).`);

    const validFiles = validateFiles(sliced);
    if (validFiles.length === 0) return;

    setUploading(true);
    const newItems: UploadQueueItem[] = validFiles.map((file, idx) => ({
      id: `${Date.now()}-${idx}-${file.name}`,
      file,
      progress: 0,
      status: 'queued' as const
    }));
    setUploadQueue((prev) => [...prev, ...newItems]);

    for (const it of newItems) {
      await uploadSingle({ id: it.id, file: it.file });
    }

    setUploading(false);
  }

  const saveImagesMutation = useMutation({
    mutationFn: (next: CloudinaryAsset[]) => adminUpdateProduct(productId, { images: next }),
    onSuccess: async () => {
      toast.success('Images saved');
      setDraftImages(null);
      await qc.invalidateQueries({ queryKey: ['admin', 'catalog', 'products'] });
      await productQuery.refetch();
    },
    onError: (e) => toast.error(normalizeApiError(e).message)
  });

  async function saveAllImages() {
    if (!canManage) return;
    const next = [...images, ...uploadedAssets].slice(0, 12);
    try {
      await saveImagesMutation.mutateAsync(next);
      setDraftImages(null);
      setUploadQueue((prev) => prev.filter((u) => u.status !== 'uploaded'));
    } catch {
      // keep queue so it's explicit that uploads are not attached yet
    }
  }

  const deleteImageMutation = useMutation({
    mutationFn: async (publicId: string) => {
      const next = images.filter((img) => img.publicId !== publicId);
      await adminDestroyImage(publicId);
      await adminUpdateProduct(productId, { images: next });
      return next;
    },
    onSuccess: async () => {
      setDraftImages(null);
      toast.success('Image deleted');
      await qc.invalidateQueries({ queryKey: ['admin', 'catalog', 'products'] });
      await productQuery.refetch();
    },
    onError: (e) => toast.error(normalizeApiError(e).message)
  });

  const [variantDialogOpen, setVariantDialogOpen] = useState(false);
  const [variantDialogMode, setVariantDialogMode] = useState<'create' | 'edit'>('create');
  const [editingVariant, setEditingVariant] = useState<ProductVariantRow | null>(null);

  const createVariantMutation = useMutation({
    mutationFn: (body: CreateVariantRequest) => adminCreateVariant(productId, body),
    onSuccess: async () => {
      await productQuery.refetch();
    },
    onError: (e) => {
      const err = normalizeApiError(e);
      if (err.errorCode === 'SKU_ALREADY_EXISTS') toast.error('SKU already exists');
      else if (err.errorCode === 'PRICE_GT_MRP') toast.error('Price must be <= MRP');
      else if (err.errorCode === 'PRODUCT_INACTIVE') toast.error('Product is inactive');
      else toast.error(err.message);
    }
  });

  const updateVariantMutation = useMutation({
    mutationFn: ({ variantId, body }: { variantId: string; body: UpdateVariantRequest }) => adminUpdateVariant(variantId, body),
    onSuccess: async () => {
      await productQuery.refetch();
    },
    onError: (e) => {
      const err = normalizeApiError(e);
      if (err.errorCode === 'SKU_ALREADY_EXISTS') toast.error('SKU already exists');
      else if (err.errorCode === 'PRICE_GT_MRP') toast.error('Price must be <= MRP');
      else if (err.errorCode === 'PRODUCT_INACTIVE') toast.error('Product is inactive');
      else toast.error(err.message);
    }
  });

  const deactivateVariantMutation = useMutation({
    mutationFn: (variantId: string) => adminDeactivateVariant(variantId),
    onSuccess: async () => {
      toast.success('Variant deactivated');
      await productQuery.refetch();
    },
    onError: (e) => toast.error(normalizeApiError(e).message)
  });

  const variants = productQuery.data?.variants ?? [];

  useEffect(() => {
    if (!canManage) return;
    if (slugDirty) return;
    const next = slugify(productName);
    if (!next) return;
    form.setValue('slug', next, { shouldDirty: false });
  }, [canManage, form, productName, slugDirty]);

  async function submitProduct(values: ProductValues) {
    if (!canManage) return;
    const abvStr = (values.abv ?? '').trim();
    const abv = abvStr ? Number(abvStr) : undefined;
    if (abvStr && Number.isNaN(abv)) {
      toast.error('ABV must be a number');
      return;
    }
    if (abv !== undefined && (abv < 0 || abv > 100)) {
      toast.error('ABV must be between 0 and 100');
      return;
    }

    await updateProductMutation.mutateAsync({
      name: values.name,
      slug: values.slug.trim(),
      brandId: values.brandId,
      categoryId: values.categoryId,
      countryOfOrigin: values.countryOfOrigin?.trim() || null,
      productType: values.productType?.trim() || null,
      subcategory: values.subcategory?.trim() || null,
      ingredients: values.ingredients?.split(',').map((item) => item.trim()).filter(Boolean) || [],
      servingSuggestion: values.servingSuggestion?.trim() || null,
      agingInfo: values.agingInfo?.trim() || null,
      authenticityNote: values.authenticityNote?.trim() || null,
      shortDescription: values.shortDescription?.trim() || null,
      tags: values.tags?.split(',').map((item) => item.trim()).filter(Boolean) || [],
      description: values.description?.trim() ? values.description.trim() : '',
      abv: abvStr ? abv : null,
      isActive: values.isActive === 'true'
    });
  }

  function openAddVariant() {
    setEditingVariant(null);
    setVariantDialogMode('create');
    setVariantDialogOpen(true);
  }

  function openEditVariant(v: ProductVariantRow) {
    setEditingVariant(v);
    setVariantDialogMode('edit');
    setVariantDialogOpen(true);
  }

  async function submitVariant(values: { sku: string; label?: string; volumeMl: number; packSize: number; price: number; mrp?: number; isActive: boolean }) {
    if (!canManage) return;
    if (variantDialogMode === 'create') {
      await createVariantMutation.mutateAsync(values);
    } else if (editingVariant) {
      await updateVariantMutation.mutateAsync({ variantId: editingVariant.id, body: values });
    }
  }

  if (productQuery.isError) return <ErrorState error={normalizeApiError(productQuery.error)} onRetry={() => productQuery.refetch()} />;

  if (productQuery.isLoading || !product) {
    return (
      <Card className="p-6">
        <div className="text-sm text-muted-foreground">Loading…</div>
      </Card>
    );
  }

  const productIsActive = product.isActive;
  const brandOptions = brandsQuery.data?.items ?? [];
  const categoryOptions = categoriesQuery.data?.items ?? [];

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm font-semibold">{product.name}</div>
              <Badge variant={product.isActive ? 'success' : 'destructive'}>{product.isActive ? 'ACTIVE' : 'INACTIVE'}</Badge>
              {!canManage ? <Badge variant="default">READ ONLY</Badge> : null}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Created {fmtDate(product.createdAt)} · Updated {fmtDate(product.updatedAt)}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => navigate(`/catalog/products${location.search}`)}>
              Back to list
            </Button>
            <Button asChild variant="secondary">
              <Link to={`/inventory?productId=${encodeURIComponent(product.id)}`}>
                Inventory <ExternalLink className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            {canManage ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive">Deactivate</Button>
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
                    <AlertDialogAction
                      onClick={() => deactivateProductMutation.mutate()}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Deactivate
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : null}
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
      <Card className="p-6 lg:col-span-2">
          <div className="text-sm font-semibold">Core details</div>
          <div className="mt-1 text-xs text-muted-foreground">Slug uniqueness is enforced. Slug auto-generates from the product name.</div>

          <form className="mt-4 grid gap-4" onSubmit={form.handleSubmit(submitProduct)}>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" disabled={!canManage} {...form.register('name')} />
                {form.formState.errors.name ? <div className="text-xs text-destructive">{form.formState.errors.name.message}</div> : null}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="slug">Slug</Label>
                <Input
                  id="slug"
                  disabled={!canManage}
                  {...form.register('slug')}
                />
                {form.formState.errors.slug ? <div className="text-xs text-destructive">{form.formState.errors.slug.message}</div> : null}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-2">
                <Label>Brand</Label>
                {canManage ? (
                  <Select value={productBrandId} onValueChange={(v) => form.setValue('brandId', v, { shouldDirty: true })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select brand" />
                    </SelectTrigger>
                    <SelectContent>
                      {brandOptions.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name} {b.isActive ? '' : '(inactive)'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input value={productQuery.data?.brand?.name ?? '—'} disabled />
                )}
                {form.formState.errors.brandId ? <div className="text-xs text-destructive">{form.formState.errors.brandId.message}</div> : null}
              </div>
              <div className="grid gap-2">
                <Label>Category</Label>
                {canManage ? (
                  <Select value={productCategoryId} onValueChange={(v) => form.setValue('categoryId', v, { shouldDirty: true })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {categoryOptions.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name} {c.isActive ? '' : '(inactive)'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input value={productQuery.data?.category?.name ?? '—'} disabled />
                )}
                {form.formState.errors.categoryId ? <div className="text-xs text-destructive">{form.formState.errors.categoryId.message}</div> : null}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="countryOfOrigin">Country of origin</Label>
                <Input id="countryOfOrigin" disabled={!canManage} {...form.register('countryOfOrigin')} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="productType">Product type</Label>
                <Input id="productType" disabled={!canManage} {...form.register('productType')} />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="subcategory">Subcategory</Label>
                <Input id="subcategory" disabled={!canManage} {...form.register('subcategory')} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="abv">ABV (optional)</Label>
                <Input id="abv" disabled={!canManage} inputMode="decimal" {...form.register('abv')} />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="shortDescription">Short description</Label>
                <Input id="shortDescription" disabled={!canManage} {...form.register('shortDescription')} />
              </div>
              <div className="grid gap-2">
                <Label>Status</Label>
                {canManage ? (
                  <Select
                    value={productIsActiveValue}
                    onValueChange={(v) => form.setValue('isActive', v as ProductValues['isActive'], { shouldDirty: true })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="true">Active</SelectItem>
                      <SelectItem value="false">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Input value={product.isActive ? 'Active' : 'Inactive'} disabled />
                )}
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="tags">Tags</Label>
              <Input id="tags" disabled={!canManage} {...form.register('tags')} />
              <div className="text-[11px] text-muted-foreground">Comma-separated. Saved as trimmed, lowercase, deduped tags.</div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="ingredients">Ingredients</Label>
              <Input id="ingredients" disabled={!canManage} {...form.register('ingredients')} />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="servingSuggestion">Serving suggestion</Label>
              <Textarea id="servingSuggestion" disabled={!canManage} rows={3} {...form.register('servingSuggestion')} />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="agingInfo">Aging info</Label>
                <Input id="agingInfo" disabled={!canManage} {...form.register('agingInfo')} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="authenticityNote">Authenticity note</Label>
                <Input id="authenticityNote" disabled={!canManage} {...form.register('authenticityNote')} />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" disabled={!canManage} rows={6} {...form.register('description')} />
            </div>

            {canManage ? (
              <div className="flex items-center justify-end gap-2 pt-2">
                <Button type="submit" disabled={updateProductMutation.isPending}>
                  Save changes
                </Button>
              </div>
            ) : null}
          </form>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">Images</div>
              <div className="mt-1 text-xs text-muted-foreground">Up to 12. First image is the primary image.</div>
            </div>
            {canManage && uploadsAllowed ? (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  multiple
                  onChange={(e) => {
                    const files = Array.from(e.currentTarget.files ?? []);
                    e.currentTarget.value = '';
                    uploadSelected(files);
                  }}
                  disabled={uploading}
                />
                <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                  <Upload className="mr-2 h-4 w-4" />
                  Upload
                </Button>
              </>
            ) : null}
          </div>

          {!uploadsAllowed && canManage ? (
            <div className="mt-3 text-xs text-muted-foreground">Uploads are restricted to Admin/SuperAdmin.</div>
          ) : null}

          {uploadQueue.length > 0 ? (
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between rounded-md border bg-muted/20 px-3 py-2 text-xs">
                <div className="text-muted-foreground">
                  {uploadedAssets.length > 0 ? (
                    <>
                      {uploadedAssets.length} uploaded <span className="text-foreground">pending attach</span>
                    </>
                  ) : (
                    'Upload queue'
                  )}
                </div>
                {canManage ? (
                  <Button size="sm" variant="secondary" disabled={uploadedAssets.length === 0 || saveImagesMutation.isPending} onClick={saveAllImages}>
                    Attach uploads
                  </Button>
                ) : null}
              </div>

              {uploadQueue.slice(-6).map((u) => (
                <div key={u.id} className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2 text-xs">
                  <div className="min-w-0">
                    <div className="truncate text-foreground">{u.file.name}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {u.status === 'uploaded' ? 'Uploaded (not yet attached)' : u.status === 'error' ? 'Upload failed' : 'Uploading…'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-[120px] rounded bg-muted/40">
                      <div className="h-1.5 rounded bg-primary" style={{ width: `${Math.max(0, Math.min(100, u.progress))}%` }} />
                    </div>
                    {u.status === 'error' && canManage && uploadsAllowed ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          setUploading(true);
                          await uploadSingle({ id: u.id, file: u.file });
                          setUploading(false);
                        }}
                        title="Retry upload"
                      >
                        <RotateCcw className="mr-2 h-4 w-4" />
                        Retry
                      </Button>
                    ) : null}
                    {u.status === 'uploaded' && u.asset?.publicId && canManage && uploadsAllowed ? (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="ghost" title="Delete from Cloudinary">
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete pending upload from Cloudinary?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This upload is not attached to the product yet. Deleting it prevents orphaned assets.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={async () => {
                                try {
                                  await adminDestroyImage(u.asset!.publicId);
                                  setUploadQueue((prev) => prev.filter((p) => p.id !== u.id));
                                  toast.success('Deleted');
                                } catch (e) {
                                  toast.error(normalizeApiError(e).message);
                                }
                              }}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <div className="mt-4 grid grid-cols-3 gap-2">
            {images.length === 0 ? <div className="col-span-3 text-xs text-muted-foreground">No images yet.</div> : null}

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={(evt) => {
                if (!canManage) return;
                const { active, over } = evt;
                if (!over || active.id === over.id) return;
                const oldIndex = images.findIndex((img) => img.publicId === active.id);
                const newIndex = images.findIndex((img) => img.publicId === over.id);
                if (oldIndex < 0 || newIndex < 0) return;
                setDraftImages(arrayMove(images, oldIndex, newIndex));
              }}
            >
              <SortableContext items={images.map((i) => i.publicId)} strategy={rectSortingStrategy}>
                {images.map((img) => (
                  <SortableImage
                    key={img.publicId}
                    image={img}
                    disabled={!canManage}
                    onRemove={() => {
                      if (!canManage) return;
                      setDraftImages(images.filter((i) => i.publicId !== img.publicId));
                    }}
                    onDeleteCloudinary={
                      canManage && uploadsAllowed
                        ? () => deleteImageMutation.mutate(img.publicId)
                        : undefined
                    }
                  />
                ))}
              </SortableContext>
            </DndContext>
          </div>

          {canManage ? (
            <div className="mt-4 flex items-center justify-between gap-2">
              <div className="text-xs text-muted-foreground">
                {imagesDirty ? 'Unsaved image changes' : uploadedAssets.length > 0 ? 'Uploads pending attach' : '—'}
              </div>
              <Button
                size="sm"
                disabled={(!imagesDirty && uploadedAssets.length === 0) || saveImagesMutation.isPending}
                onClick={saveAllImages}
              >
                Save changes
              </Button>
            </div>
          ) : null}
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <div className="text-sm font-semibold">Variants</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Inactive product → variants cannot be active. Stock is read-only here.
            </div>
          </div>
          {canManage ? (
            <Button size="sm" onClick={openAddVariant}>
              <Plus className="mr-2 h-4 w-4" />
              Add variant
            </Button>
          ) : null}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">SKU</th>
                <th className="px-4 py-3 font-medium">Label</th>
                <th className="px-4 py-3 font-medium">Volume</th>
                <th className="px-4 py-3 font-medium">Pack</th>
                <th className="px-4 py-3 font-medium">Price</th>
                <th className="px-4 py-3 font-medium">MRP</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Stock</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {variants.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-muted-foreground" colSpan={9}>
                    No variants yet.
                  </td>
                </tr>
              ) : null}

              {variants.map((v) => (
                <tr key={v.id} className="border-t">
                  <td className="px-4 py-3">
                    <div className="font-mono text-xs">{v.sku}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      <Link to={`/inventory?tab=history&q=${encodeURIComponent(v.sku)}`} className="inline-flex items-center gap-1 hover:underline">
                        History <ExternalLink className="h-3 w-3" />
                      </Link>
                    </div>
                  </td>
                  <td className="px-4 py-3">{v.label ?? '—'}</td>
                  <td className="px-4 py-3">{v.volumeMl}ml</td>
                  <td className="px-4 py-3">{v.packSize}</td>
                  <td className="px-4 py-3">{v.price}</td>
                  <td className="px-4 py-3 text-muted-foreground">{v.mrp ?? '—'}</td>
                  <td className="px-4 py-3">
                    <Badge variant={v.isActive ? 'success' : 'destructive'}>{v.isActive ? 'ACTIVE' : 'INACTIVE'}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-xs text-muted-foreground">
                      qty {v.stock.quantity} · res {v.stock.reserved} · avail {v.stock.available}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canManage ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" variant="secondary">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEditVariant(v)}>Edit</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={(e) => e.preventDefault()}>
                                Deactivate
                              </DropdownMenuItem>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Deactivate variant?</AlertDialogTitle>
                                <AlertDialogDescription>This sets the variant to inactive. Inventory is not changed.</AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => deactivateVariantMutation.mutate(v.id)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Deactivate
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      <div className="text-xs text-muted-foreground">—</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <VariantDialog
        open={variantDialogOpen}
        mode={variantDialogMode}
        productIsActive={productIsActive}
        initial={editingVariant}
        onOpenChange={setVariantDialogOpen}
        onSubmit={submitVariant}
      />
    </div>
  );
}
