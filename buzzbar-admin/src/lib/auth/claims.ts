import { jwtDecode } from 'jwt-decode';

export type AdminRole = 'superadmin' | 'admin' | 'employee';

export type AdminClaims = {
  adminId: string;
  role: AdminRole;
  exp?: number;
};

type RawJwt = {
  sub?: string;
  exp?: number;
  role?: string;
};

export function parseAdminClaimsFromAccessToken(accessToken: string): AdminClaims | null {
  try {
    const raw = jwtDecode<RawJwt>(accessToken);
    const adminId = typeof raw.sub === 'string' && raw.sub.length > 0 ? raw.sub : null;
    const role = typeof raw.role === 'string' ? raw.role : null;
    if (!adminId || !role) return null;
    if (role !== 'superadmin' && role !== 'admin' && role !== 'employee') return null;
    return { adminId, role, exp: typeof raw.exp === 'number' ? raw.exp : undefined };
  } catch {
    return null;
  }
}

export function isTokenExpired(claims: AdminClaims | null | undefined, nowMs = Date.now()) {
  if (!claims?.exp) return false;
  return claims.exp * 1000 <= nowMs + 5_000; // 5s clock skew
}

