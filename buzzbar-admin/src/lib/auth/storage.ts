const REFRESH_TOKEN_KEY = 'bb_admin_refresh_token';
const ADMIN_PROFILE_KEY = 'bb_admin_admin_profile';

export function getStoredRefreshToken(): string | null {
  try {
    const v = localStorage.getItem(REFRESH_TOKEN_KEY);
    return v && v.trim().length > 0 ? v : null;
  } catch {
    return null;
  }
}

export function setStoredRefreshToken(token: string) {
  try {
    localStorage.setItem(REFRESH_TOKEN_KEY, token);
  } catch {
    // ignore
  }
}

export function clearStoredRefreshToken() {
  try {
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  } catch {
    // ignore
  }
}

export type AdminProfileDisplay = {
  email?: string;
};

export function getStoredAdminProfile(): AdminProfileDisplay | null {
  try {
    const raw = localStorage.getItem(ADMIN_PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const maybe = parsed as { email?: unknown };
    const email = typeof maybe.email === 'string' ? maybe.email : undefined;
    return { email };
  } catch {
    return null;
  }
}

export function setStoredAdminProfile(profile: AdminProfileDisplay) {
  try {
    localStorage.setItem(ADMIN_PROFILE_KEY, JSON.stringify({ email: profile.email }));
  } catch {
    // ignore
  }
}

export function clearStoredAdminProfile() {
  try {
    localStorage.removeItem(ADMIN_PROFILE_KEY);
  } catch {
    // ignore
  }
}
