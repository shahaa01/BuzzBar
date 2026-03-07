import { SignJWT, jwtVerify } from 'jose';
import { randomUUID } from 'node:crypto';

type JwtKind = 'access' | 'refresh';

type AdminJwtPayload = {
  typ: JwtKind;
  sid?: string;
  role?: string;
};

function requiredEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

function getSecrets() {
  return {
    accessSecret: requiredEnv('ADMIN_JWT_ACCESS_SECRET'),
    refreshSecret: requiredEnv('ADMIN_JWT_REFRESH_SECRET')
  };
}

function getTtls() {
  const accessMin = Number(process.env.ADMIN_ACCESS_TOKEN_TTL_MIN ?? '15');
  const refreshDays = Number(process.env.ADMIN_REFRESH_TOKEN_TTL_DAYS ?? '30');
  return { accessMin, refreshDays };
}

export async function signAdminAccessToken(opts: { adminId: string; role: string }) {
  const { accessSecret } = getSecrets();
  const { accessMin } = getTtls();
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({ typ: 'access', role: opts.role } satisfies AdminJwtPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(opts.adminId)
    .setAudience('buzzbar-admin')
    .setIssuedAt(now)
    .setExpirationTime(now + accessMin * 60)
    .setJti(randomUUID())
    .sign(new TextEncoder().encode(accessSecret));
}

export async function signAdminRefreshToken(opts: { adminId: string; sessionId: string }) {
  const { refreshSecret } = getSecrets();
  const { refreshDays } = getTtls();
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({ typ: 'refresh', sid: opts.sessionId } satisfies AdminJwtPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(opts.adminId)
    .setAudience('buzzbar-admin')
    .setIssuedAt(now)
    .setExpirationTime(now + refreshDays * 24 * 60 * 60)
    .setJti(randomUUID())
    .sign(new TextEncoder().encode(refreshSecret));
}

export async function verifyAdminAccessToken(token: string) {
  const { accessSecret } = getSecrets();
  const res = await jwtVerify<AdminJwtPayload>(token, new TextEncoder().encode(accessSecret), {
    audience: 'buzzbar-admin'
  });
  if (res.payload.typ !== 'access') throw new Error('Invalid token type');
  if (!res.payload.sub) throw new Error('Missing sub');
  if (!res.payload.role) throw new Error('Missing role');
  return { adminId: res.payload.sub, role: res.payload.role };
}

export async function verifyAdminRefreshToken(token: string) {
  const { refreshSecret } = getSecrets();
  const res = await jwtVerify<AdminJwtPayload>(token, new TextEncoder().encode(refreshSecret), {
    audience: 'buzzbar-admin'
  });
  if (res.payload.typ !== 'refresh') throw new Error('Invalid token type');
  if (!res.payload.sub) throw new Error('Missing sub');
  if (!res.payload.sid) throw new Error('Missing sid');
  return { adminId: res.payload.sub, sessionId: res.payload.sid };
}

