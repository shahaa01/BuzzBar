import { jwtVerify } from 'jose';

type OauthProvider = 'google' | 'apple';

export type VerifiedOauthProfile = {
  provider: OauthProvider;
  sub: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  picture?: string;
};

function requiredEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

export async function verifyTestOauthIdToken(opts: {
  provider: OauthProvider;
  idToken: string;
  expectedIss: string;
  allowedAudiences: string[];
}) {
  const secret = requiredEnv('OAUTH_TEST_SECRET');
  const res = await jwtVerify<any>(opts.idToken, new TextEncoder().encode(secret), {
    audience: opts.allowedAudiences
  });

  if (res.payload.iss !== opts.expectedIss) throw new Error('Invalid issuer');
  if (!res.payload.sub) throw new Error('Missing sub');

  return {
    provider: opts.provider,
    sub: String(res.payload.sub),
    email: res.payload.email ? String(res.payload.email) : undefined,
    emailVerified: res.payload.email_verified === undefined ? undefined : Boolean(res.payload.email_verified),
    name: res.payload.name ? String(res.payload.name) : undefined,
    picture: res.payload.picture ? String(res.payload.picture) : undefined
  } satisfies VerifiedOauthProfile;
}

