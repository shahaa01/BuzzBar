import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { VerifiedOauthProfile } from './oauth_test.js';
import { verifyTestOauthIdToken } from './oauth_test.js';

const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

function getAllowedAudiences() {
  const raw = process.env.GOOGLE_OAUTH_CLIENT_IDS ?? '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export async function verifyGoogleIdToken(idToken: string): Promise<VerifiedOauthProfile> {
  const allowedAudiences = getAllowedAudiences();
  if (allowedAudiences.length === 0 && process.env.NODE_ENV !== 'test') {
    throw new Error('GOOGLE_OAUTH_CLIENT_IDS not configured');
  }

  if (process.env.NODE_ENV === 'test' || process.env.OAUTH_MODE === 'test') {
    return verifyTestOauthIdToken({
      provider: 'google',
      idToken,
      expectedIss: 'https://accounts.google.com',
      allowedAudiences
    });
  }

  const res = await jwtVerify<any>(idToken, GOOGLE_JWKS, {
    audience: allowedAudiences
  });

  if (!GOOGLE_ISSUERS.has(String(res.payload.iss))) throw new Error('Invalid issuer');
  if (!res.payload.sub) throw new Error('Missing sub');

  return {
    provider: 'google',
    sub: String(res.payload.sub),
    email: res.payload.email ? String(res.payload.email) : undefined,
    emailVerified: res.payload.email_verified === undefined ? undefined : Boolean(res.payload.email_verified),
    name: res.payload.name ? String(res.payload.name) : undefined,
    picture: res.payload.picture ? String(res.payload.picture) : undefined
  };
}

