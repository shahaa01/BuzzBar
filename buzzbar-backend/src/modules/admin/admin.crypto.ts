import { createHash, timingSafeEqual } from 'node:crypto';

export function sha256Base64Url(input: string) {
  const digest = createHash('sha256').update(input).digest('base64url');
  return digest;
}

export function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

