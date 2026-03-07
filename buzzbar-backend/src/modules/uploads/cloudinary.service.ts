import { v2 as cloudinary } from 'cloudinary';
import type { CloudinaryAsset } from '../catalog/catalog.models.js';

type CloudinaryConfig = {
  cloud_name: string;
  api_key: string;
  api_secret: string;
};

function getCloudinaryConfig(): CloudinaryConfig | null {
  if (process.env.CLOUDINARY_URL && process.env.CLOUDINARY_URL.trim().length > 0) {
    cloudinary.config({ cloudinary_url: process.env.CLOUDINARY_URL.trim() } as any);
    // cloudinary.v2 reads from CLOUDINARY_URL internally; still return null to indicate "configured"
    return { cloud_name: 'from_url', api_key: 'from_url', api_secret: 'from_url' };
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
  const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();
  if (!cloudName || !apiKey || !apiSecret) return null;

  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });
  return { cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret };
}

export class CloudinaryNotConfiguredError extends Error {
  constructor() {
    super('Cloudinary not configured');
  }
}

export async function uploadImageToCloudinary(opts: {
  buffer: Buffer;
  folder: string;
  type?: 'upload' | 'private';
}): Promise<CloudinaryAsset> {
  if (process.env.NODE_ENV === 'test') {
    return {
      url: 'https://example.com/test-upload.png',
      publicId: 'test_public_id',
      width: 100,
      height: 100,
      format: 'png'
    };
  }

  const configured = getCloudinaryConfig();
  if (!configured) {
    throw new CloudinaryNotConfiguredError();
  }

  const result = await new Promise<any>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: opts.folder,
        resource_type: 'image',
        overwrite: false,
        type: opts.type ?? 'upload'
      },
      (error, res) => {
        if (error) return reject(error);
        return resolve(res);
      }
    );
    stream.end(opts.buffer);
  });

  return {
    url: result.secure_url ?? result.url,
    publicId: result.public_id,
    width: result.width,
    height: result.height,
    format: result.format
  };
}

export function getSignedPrivateDownloadUrl(opts: { publicId: string; format: string; expiresAtUnixSec: number }) {
  if (process.env.NODE_ENV === 'test') {
    return 'https://example.com/test-private-signed.png';
  }

  const configured = getCloudinaryConfig();
  if (!configured) {
    throw new CloudinaryNotConfiguredError();
  }

  return cloudinary.utils.private_download_url(opts.publicId, opts.format, {
    resource_type: 'image',
    type: 'private',
    expires_at: opts.expiresAtUnixSec,
    attachment: false
  });
}

export async function destroyCloudinaryImage(publicId: string) {
  if (process.env.NODE_ENV === 'test') {
    return { result: 'ok' };
  }

  const configured = getCloudinaryConfig();
  if (!configured) {
    throw new CloudinaryNotConfiguredError();
  }

  const res = await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
  return res;
}
