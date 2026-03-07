import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { VerifiedOauthProfile } from './oauth_test.js';
import { verifyTestOauthIdToken } from './oauth_test.js';

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

function getAllowedAudiences() {
  const raw = process.env.APPLE_CLIENT_IDS ?? '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export async function verifyAppleIdentityToken(identityToken: string): Promise<VerifiedOauthProfile> {
  const allowedAudiences = getAllowedAudiences();
  if (allowedAudiences.length === 0 && process.env.NODE_ENV !== 'test') {
    throw new Error('APPLE_CLIENT_IDS not configured');
  }

  if (process.env.NODE_ENV === 'test' || process.env.OAUTH_MODE === 'test') {
    return verifyTestOauthIdToken({
      provider: 'apple',
      idToken: identityToken,
      expectedIss: APPLE_ISSUER,
      allowedAudiences
    });
  }

  const res = await jwtVerify<any>(identityToken, APPLE_JWKS, {
    audience: allowedAudiences,
    issuer: APPLE_ISSUER
  });

  if (!res.payload.sub) throw new Error('Missing sub');

  return {
    provider: 'apple',
    sub: String(res.payload.sub),
    email: res.payload.email ? String(res.payload.email) : undefined,
    emailVerified: res.payload.email_verified === undefined ? undefined : Boolean(res.payload.email_verified)
  };
}

