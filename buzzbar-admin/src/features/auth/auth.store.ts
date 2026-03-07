import { create } from 'zustand';
import { authHttp } from '../../lib/api/http.js';
import { parseAdminClaimsFromAccessToken, type AdminClaims, isTokenExpired } from '../../lib/auth/claims.js';
import { clearStoredAdminProfile, clearStoredRefreshToken, getStoredRefreshToken, setStoredAdminProfile, setStoredRefreshToken } from '../../lib/auth/storage.js';
import { normalizeApiError } from '../../lib/api/normalizeError.js';

type AuthStatus = 'idle' | 'bootstrapping' | 'authenticated' | 'unauthenticated';

type AuthState = {
  status: AuthStatus;
  accessToken: string | null;
  claims: AdminClaims | null;

  setSession: (opts: { accessToken: string; claims: AdminClaims }) => void;
  clearSession: () => void;

  bootstrap: () => Promise<void>;
  login: (opts: { email: string; password: string }) => Promise<{ ok: true } | { ok: false; message: string; errorCode?: string }>;
  logout: () => Promise<void>;
};

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'idle',
  accessToken: null,
  claims: null,

  setSession: ({ accessToken, claims }) => set({ accessToken, claims, status: 'authenticated' }),
  clearSession: () => set({ accessToken: null, claims: null, status: 'unauthenticated' }),

  async bootstrap() {
    if (get().status === 'bootstrapping' || get().status === 'authenticated') return;
    set({ status: 'bootstrapping' });

    const refreshToken = getStoredRefreshToken();
    if (!refreshToken) {
      set({ status: 'unauthenticated', accessToken: null, claims: null });
      return;
    }

    try {
      const res = await authHttp.post('/api/v1/admin/auth/refresh', {}, { headers: { Authorization: `Bearer ${refreshToken}` } });
      const token = String(res.data?.data?.token ?? '');
      const newRefreshToken = String(res.data?.data?.refreshToken ?? '');
      const claims = parseAdminClaimsFromAccessToken(token);
      if (!token || !claims || isTokenExpired(claims)) throw new Error('Invalid token');

      if (newRefreshToken) setStoredRefreshToken(newRefreshToken);
      set({ status: 'authenticated', accessToken: token, claims });
    } catch {
      clearStoredRefreshToken();
      clearStoredAdminProfile();
      set({ status: 'unauthenticated', accessToken: null, claims: null });
    }
  },

  async login({ email, password }) {
    try {
      const res = await authHttp.post('/api/v1/admin/auth/login', { email, password });
      const token = String(res.data?.data?.token ?? '');
      const refreshToken = String(res.data?.data?.refreshToken ?? '');
      const claims = parseAdminClaimsFromAccessToken(token);
      if (!token || !refreshToken || !claims) {
        return { ok: false as const, message: 'Login failed', errorCode: 'LOGIN_FAILED' };
      }

      setStoredRefreshToken(refreshToken);
      setStoredAdminProfile({ email: email.toLowerCase().trim() });
      set({ status: 'authenticated', accessToken: token, claims });
      return { ok: true as const };
    } catch (err: unknown) {
      const e = normalizeApiError(err);
      return { ok: false as const, message: e.message ?? 'Login failed', errorCode: e.errorCode };
    }
  },

  async logout() {
    const accessToken = get().accessToken;
    const refreshToken = getStoredRefreshToken();

    try {
      if (accessToken) {
        await authHttp.post(
          '/api/v1/admin/auth/logout',
          refreshToken ? { refreshToken } : {},
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              ...(refreshToken ? { 'x-refresh-token': refreshToken } : {})
            }
          }
        );
      }
    } catch {
      // ignore errors on logout; always clear client state
    } finally {
      clearStoredRefreshToken();
      clearStoredAdminProfile();
      set({ status: 'unauthenticated', accessToken: null, claims: null });
    }
  }
}));
