import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '../../../components/ui/button.js';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog.js';
import { Input } from '../../../components/ui/input.js';
import { Label } from '../../../components/ui/label.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select.js';
import type { ApiErrorShape } from '../../../lib/api/normalizeError.js';
import { normalizeApiError } from '../../../lib/api/normalizeError.js';
import type { CategoryAdminRow } from './categories.types.js';
import type { CloudinaryAsset } from '../brands/brands.types.js';
import { Card } from '../../../components/ui/card.js';
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

const MAX_FILE_SIZE_BYTES = 7 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

const schema = z.object({
  name: z.string().min(1, 'Name is required').max(120),
  slug: z.string().max(120).optional(),
  sortOrder: z.number().int().min(0).max(1_000_000),
  isActive: z.enum(['true', 'false'])
});

export type CategoryUpsertValues = z.infer<typeof schema>;

export function CategoryUpsertDialog(props: {
  open: boolean;
  mode: 'create' | 'edit';
  initial?: CategoryAdminRow | null;
  uploadsAllowed: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: { values: { name: string; slug?: string; sortOrder: number; isActive: boolean }; file?: File }) => Promise<void>;
  onRemoveImage?: () => Promise<void>;
  onDeleteImage?: (publicId: string) => Promise<void>;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | undefined>(undefined);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const defaultValues = useMemo(() => {
    if (props.mode === 'edit' && props.initial) {
      return {
        name: props.initial.name ?? '',
        slug: props.initial.slug ?? '',
        sortOrder: Number(props.initial.sortOrder ?? 0),
        isActive: props.initial.isActive ? 'true' : 'false'
      } satisfies CategoryUpsertValues;
    }
    return { name: '', slug: '', sortOrder: 0, isActive: 'true' } satisfies CategoryUpsertValues;
  }, [props.initial, props.mode]);

  const form = useForm<CategoryUpsertValues>({
    resolver: zodResolver(schema),
    defaultValues
  });

  const isActive = useWatch({ control: form.control, name: 'isActive' });

  useEffect(() => {
    if (props.open) {
      form.reset(defaultValues);
      setFile(undefined);
    }
  }, [defaultValues, form, props.open]);

  useEffect(() => {
    if (!file) {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  function validateAndSetFile(next?: File) {
    if (!next) {
      setFile(undefined);
      return;
    }
    if (!ALLOWED_MIME.has(next.type)) {
      toast.error('Unsupported file type. Use JPG, PNG, or WebP.');
      return;
    }
    if (next.size > MAX_FILE_SIZE_BYTES) {
      toast.error('File too large. Max size is 7MB.');
      return;
    }
    setFile(next);
  }

  async function submit(values: CategoryUpsertValues) {
    try {
      await props.onSubmit({
        values: {
          name: values.name,
          slug: values.slug?.trim() ? values.slug.trim() : undefined,
          sortOrder: values.sortOrder,
          isActive: values.isActive === 'true'
        },
        file: props.uploadsAllowed ? file : undefined
      });
      toast.success(props.mode === 'create' ? 'Category created' : 'Category updated');
      props.onOpenChange(false);
    } catch (e) {
      const err: ApiErrorShape = normalizeApiError(e);
      if (err.errorCode === 'SLUG_ALREADY_EXISTS') toast.error('Slug already exists');
      else toast.error(err.message);
    }
  }

  const currentImage: CloudinaryAsset | undefined = props.initial?.image;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{props.mode === 'create' ? 'Create category' : 'Edit category'}</DialogTitle>
          <DialogDescription>
            Keep categories stable. Deactivating a category that is used by products will be blocked.
          </DialogDescription>
        </DialogHeader>

        <form className="grid gap-4" onSubmit={form.handleSubmit(submit)}>
          <div className="grid gap-2">
            <Label>Category image</Label>
            <Card className="flex items-center justify-between gap-3 p-3">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 overflow-hidden rounded-md border bg-muted/40">
                  {previewUrl ? (
                    <img src={previewUrl} alt="New category image preview" className="h-full w-full object-cover" />
                  ) : currentImage?.url ? (
                    <img src={currentImage.url} alt="Category image" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">—</div>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-medium">Thumbnail</div>
                  <div className="text-[11px] text-muted-foreground">
                    {props.uploadsAllowed ? 'JPG/PNG/WebP up to 7MB.' : 'Uploads are restricted to Admin/SuperAdmin.'}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => validateAndSetFile(e.currentTarget.files?.[0])}
                  disabled={!props.uploadsAllowed}
                />
                <Button type="button" variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()} disabled={!props.uploadsAllowed}>
                  {currentImage?.url || previewUrl ? 'Change' : 'Upload'}
                </Button>
                {previewUrl ? (
                  <Button type="button" variant="secondary" size="sm" onClick={() => validateAndSetFile(undefined)} disabled={!props.uploadsAllowed}>
                    Clear
                  </Button>
                ) : null}
              </div>
            </Card>

            {props.mode === 'edit' && currentImage?.publicId && props.uploadsAllowed ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={() => props.onRemoveImage?.()} disabled={!props.onRemoveImage}>
                  Remove from category
                </Button>

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="destructive" size="sm">
                      Delete from Cloudinary
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete category image from Cloudinary?</AlertDialogTitle>
                      <AlertDialogDescription>This permanently deletes the asset. This action is intentionally explicit.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel asChild>
                        <Button variant="secondary">Cancel</Button>
                      </AlertDialogCancel>
                      <AlertDialogAction asChild>
                        <Button variant="destructive" onClick={() => props.onDeleteImage?.(currentImage.publicId)} disabled={!props.onDeleteImage}>
                          Delete
                        </Button>
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            ) : null}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" placeholder="e.g. Whiskey" {...form.register('name')} />
            {form.formState.errors.name ? <div className="text-xs text-destructive">{form.formState.errors.name.message}</div> : null}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="slug">Slug (optional)</Label>
            <Input id="slug" placeholder="e.g. whiskey" {...form.register('slug')} />
            <div className="text-xs text-muted-foreground">If empty, the backend will derive a slug from the name.</div>
            {form.formState.errors.slug ? <div className="text-xs text-destructive">{form.formState.errors.slug.message}</div> : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="sortOrder">Sort order</Label>
              <Input id="sortOrder" type="number" inputMode="numeric" {...form.register('sortOrder', { valueAsNumber: true })} />
              {form.formState.errors.sortOrder ? (
                <div className="text-xs text-destructive">{form.formState.errors.sortOrder.message}</div>
              ) : null}
            </div>
            <div className="grid gap-2">
              <Label>Status</Label>
              <Select value={isActive} onValueChange={(v) => form.setValue('isActive', v as CategoryUpsertValues['isActive'], { shouldDirty: true })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">Active</SelectItem>
                  <SelectItem value="false">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="mt-2">
            <Button type="button" variant="secondary" onClick={() => props.onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {props.mode === 'create' ? 'Create' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
