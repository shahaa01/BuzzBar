import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ErrorState } from '../../../components/feedback/ErrorState.js';
import { Button } from '../../../components/ui/button.js';
import { Card } from '../../../components/ui/card.js';
import { Input } from '../../../components/ui/input.js';
import { Label } from '../../../components/ui/label.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select.js';
import { Textarea } from '../../../components/ui/textarea.js';
import { normalizeApiError } from '../../../lib/api/normalizeError.js';
import { slugify } from '../../../lib/utils/slugify.js';
import { adminListBrands } from '../brands/brands.api.js';
import { adminListCategories } from '../categories/categories.api.js';
import { adminCreateProduct } from './products.api.js';
import { z } from 'zod';

const schema = z.object({
  name: z.string().min(1, 'Name is required').max(140),
  slug: z.string().max(140).optional(),
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

type Values = z.infer<typeof schema>;

export function CatalogProductNewPage() {
  const navigate = useNavigate();
  const location = useLocation();

  const brandsQuery = useQuery({
    queryKey: ['admin', 'catalog', 'brands', 'forSelect', 'all'],
    queryFn: () => adminListBrands({ page: 1, limit: 100, isActive: 'all' as const })
  });

  const categoriesQuery = useQuery({
    queryKey: ['admin', 'catalog', 'categories', 'forSelect', 'all'],
    queryFn: () => adminListCategories({ page: 1, limit: 100, isActive: 'all' as const })
  });

  const defaultValues = useMemo(
    () =>
      ({
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
      }) satisfies Values,
    []
  );

  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues });
  const name = useWatch({ control: form.control, name: 'name' });
  const brandId = useWatch({ control: form.control, name: 'brandId' });
  const categoryId = useWatch({ control: form.control, name: 'categoryId' });
  const isActive = useWatch({ control: form.control, name: 'isActive' });
  const slugDirty = Boolean(form.formState.dirtyFields.slug);

  const createMutation = useMutation({
    mutationFn: adminCreateProduct,
    onSuccess: (p) => {
      toast.success('Product created');
      navigate(`/catalog/products/${p._id}${location.search}`);
    },
    onError: (e) => {
      const err = normalizeApiError(e);
      if (err.errorCode === 'SLUG_ALREADY_EXISTS') toast.error('Slug already exists');
      else toast.error(err.message);
    }
  });

  useEffect(() => {
    if (slugDirty) return;
    const next = slugify(name);
    if (!next) return;
    form.setValue('slug', next, { shouldDirty: false });
  }, [form, name, slugDirty]);

  async function submit(values: Values) {
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

    await createMutation.mutateAsync({
      name: values.name,
      slug: values.slug?.trim() ? values.slug.trim() : undefined,
      brandId: values.brandId,
      categoryId: values.categoryId,
      countryOfOrigin: values.countryOfOrigin?.trim() || undefined,
      productType: values.productType?.trim() || undefined,
      subcategory: values.subcategory?.trim() || undefined,
      ingredients: values.ingredients?.split(',').map((item) => item.trim()).filter(Boolean) || undefined,
      servingSuggestion: values.servingSuggestion?.trim() || undefined,
      agingInfo: values.agingInfo?.trim() || undefined,
      authenticityNote: values.authenticityNote?.trim() || undefined,
      shortDescription: values.shortDescription?.trim() || undefined,
      tags: values.tags?.split(',').map((item) => item.trim()).filter(Boolean) || undefined,
      description: values.description?.trim() ? values.description.trim() : undefined,
      abv,
      isActive: values.isActive === 'true'
    });
  }

  const busy = createMutation.isPending || brandsQuery.isLoading || categoriesQuery.isLoading;

  return (
    <div className="space-y-4">
      {brandsQuery.isError ? <ErrorState error={normalizeApiError(brandsQuery.error)} onRetry={() => brandsQuery.refetch()} /> : null}
      {categoriesQuery.isError ? <ErrorState error={normalizeApiError(categoriesQuery.error)} onRetry={() => categoriesQuery.refetch()} /> : null}

      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">New product</div>
            <div className="mt-1 text-xs text-muted-foreground">Create the product first, then manage images and variants.</div>
          </div>
          <Button variant="secondary" onClick={() => navigate(`/catalog/products${location.search}`)}>
            Back to list
          </Button>
        </div>
      </Card>

      <Card className="p-6">
        <form className="grid gap-4" onSubmit={form.handleSubmit(submit)}>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" placeholder="e.g. Old Monk XXX Rum" {...form.register('name')} />
              {form.formState.errors.name ? <div className="text-xs text-destructive">{form.formState.errors.name.message}</div> : null}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="slug">Slug</Label>
              <Input
                id="slug"
                placeholder="auto-generated"
                {...form.register('slug')}
              />
              <div className="text-[11px] text-muted-foreground">Lowercase, spaces → hyphen, special characters removed.</div>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-2">
              <Label>Brand</Label>
              <Select value={brandId} onValueChange={(v) => form.setValue('brandId', v, { shouldDirty: true })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select brand" />
                </SelectTrigger>
                <SelectContent>
                  {(brandsQuery.data?.items ?? []).map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name} {b.isActive ? '' : '(inactive)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.formState.errors.brandId ? <div className="text-xs text-destructive">{form.formState.errors.brandId.message}</div> : null}
            </div>
            <div className="grid gap-2">
              <Label>Category</Label>
              <Select value={categoryId} onValueChange={(v) => form.setValue('categoryId', v, { shouldDirty: true })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {(categoriesQuery.data?.items ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} {c.isActive ? '' : '(inactive)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.formState.errors.categoryId ? <div className="text-xs text-destructive">{form.formState.errors.categoryId.message}</div> : null}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="countryOfOrigin">Country of origin</Label>
              <Input id="countryOfOrigin" placeholder="e.g. Scotland" {...form.register('countryOfOrigin')} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="productType">Product type</Label>
              <Input id="productType" placeholder="e.g. Whisky" {...form.register('productType')} />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="subcategory">Subcategory</Label>
              <Input id="subcategory" placeholder="e.g. Single Malt" {...form.register('subcategory')} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="abv">ABV (optional)</Label>
              <Input id="abv" placeholder="e.g. 42.8" inputMode="decimal" {...form.register('abv')} />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-2">
              <Label>Status</Label>
              <Select value={isActive} onValueChange={(v) => form.setValue('isActive', v as Values['isActive'], { shouldDirty: true })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">Active</SelectItem>
                  <SelectItem value="false">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="shortDescription">Short description</Label>
              <Input id="shortDescription" placeholder="Short merchandising summary" {...form.register('shortDescription')} />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="tags">Tags</Label>
            <Input id="tags" placeholder="e.g. smoky, peated, premium" {...form.register('tags')} />
            <div className="text-[11px] text-muted-foreground">Comma-separated. Tags are trimmed, lowercased, deduped, and empty values are dropped.</div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="ingredients">Ingredients</Label>
            <Input id="ingredients" placeholder="e.g. Malted barley, water, yeast" {...form.register('ingredients')} />
            <div className="text-[11px] text-muted-foreground">Comma-separated ingredient list.</div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="servingSuggestion">Serving suggestion</Label>
            <Textarea id="servingSuggestion" rows={3} placeholder="How this is best served" {...form.register('servingSuggestion')} />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="agingInfo">Aging info</Label>
              <Input id="agingInfo" placeholder="e.g. Aged 12 years" {...form.register('agingInfo')} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="authenticityNote">Authenticity note</Label>
              <Input id="authenticityNote" placeholder="Origin or authenticity note" {...form.register('authenticityNote')} />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea id="description" rows={5} placeholder="Short, customer-facing description…" {...form.register('description')} />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => navigate(`/catalog/products${location.search}`)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              Create product
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
