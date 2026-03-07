import { SignJWT, jwtVerify } from 'jose';
import { randomUUID } from 'node:crypto';

type JwtKind = 'access' | 'refresh';

type UserJwtPayload = {
  typ: JwtKind;
  sid?: string;
};

function requiredEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

function getSecrets() {
  return {
    accessSecret: requiredEnv('USER_JWT_ACCESS_SECRET'),
    refreshSecret: requiredEnv('USER_JWT_REFRESH_SECRET')
  };
}

function getTtls() {
  const accessMin = Number(process.env.USER_ACCESS_TOKEN_TTL_MIN ?? '15');
  const refreshDays = Number(process.env.USER_REFRESH_TOKEN_TTL_DAYS ?? '30');
  return { accessMin, refreshDays };
}

export async function signUserAccessToken(opts: { userId: string }) {
  const { accessSecret } = getSecrets();
  const { accessMin } = getTtls();
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({ typ: 'access' } satisfies UserJwtPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(opts.userId)
    .setAudience('buzzbar-user')
    .setIssuedAt(now)
    .setExpirationTime(now + accessMin * 60)
    .setJti(randomUUID())
    .sign(new TextEncoder().encode(accessSecret));
}

export async function signUserRefreshToken(opts: { userId: string; sessionId: string }) {
  const { refreshSecret } = getSecrets();
  const { refreshDays } = getTtls();
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({ typ: 'refresh', sid: opts.sessionId } satisfies UserJwtPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(opts.userId)
    .setAudience('buzzbar-user')
    .setIssuedAt(now)
    .setExpirationTime(now + refreshDays * 24 * 60 * 60)
    .setJti(randomUUID())
    .sign(new TextEncoder().encode(refreshSecret));
}

export async function verifyUserAccessToken(token: string) {
  const { accessSecret } = getSecrets();
  const res = await jwtVerify<UserJwtPayload>(token, new TextEncoder().encode(accessSecret), {
    audience: 'buzzbar-user'
  });
  if (res.payload.typ !== 'access') throw new Error('Invalid token type');
  if (!res.payload.sub) throw new Error('Missing sub');
  return { userId: res.payload.sub };
}

export async function verifyUserRefreshToken(token: string) {
  const { refreshSecret } = getSecrets();
  const res = await jwtVerify<UserJwtPayload>(token, new TextEncoder().encode(refreshSecret), {
    audience: 'buzzbar-user'
  });
  if (res.payload.typ !== 'refresh') throw new Error('Invalid token type');
  if (!res.payload.sub) throw new Error('Missing sub');
  if (!res.payload.sid) throw new Error('Missing sid');
  return { userId: res.payload.sub, sessionId: res.payload.sid };
}

