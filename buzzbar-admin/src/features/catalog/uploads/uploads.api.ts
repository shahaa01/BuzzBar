import { api } from '../../../lib/api/client.js';
import type { CloudinaryAsset } from '../brands/brands.types.js';

export async function adminUploadImage(input: {
  file: File;
  target?: 'categories' | 'brands' | 'products';
  targetId?: string;
  onProgress?: (pct: number) => void;
}): Promise<CloudinaryAsset> {
  const form = new FormData();
  form.append('file', input.file);
  if (input.target) form.append('target', input.target);
  if (input.targetId) form.append('targetId', input.targetId);

  const res = await api.post('/api/v1/admin/uploads/image', form, {
    onUploadProgress: (evt) => {
      const total = evt.total ?? 0;
      if (!total) return;
      const pct = Math.max(0, Math.min(100, Math.round((evt.loaded / total) * 100)));
      input.onProgress?.(pct);
    }
  });
  return res.data.data as CloudinaryAsset;
}

export async function adminDestroyImage(publicId: string) {
  const res = await api.post('/api/v1/admin/uploads/destroy', { publicId });
  return res.data.data as unknown;
}
