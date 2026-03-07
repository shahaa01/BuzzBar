import { AxiosHeaders, type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { apiHttp, authHttp } from './http.js';
import { getStoredRefreshToken, setStoredRefreshToken, clearStoredRefreshToken, clearStoredAdminProfile } from '../auth/storage.js';
import { useAuthStore } from '../../features/auth/auth.store.js';
import { parseAdminClaimsFromAccessToken } from '../auth/claims.js';

let installed = false;
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessTokenSingleFlight(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const refreshToken = getStoredRefreshToken();
    if (!refreshToken) return null;

    try {
      const res = await authHttp.post(
        '/api/v1/admin/auth/refresh',
        {},
        { headers: { Authorization: `Bearer ${refreshToken}` } }
      );
      const token = String(res.data?.data?.token ?? '');
      const newRefreshToken = String(res.data?.data?.refreshToken ?? '');
      const claims = parseAdminClaimsFromAccessToken(token);
      if (!token || !claims) return null;

      if (newRefreshToken) setStoredRefreshToken(newRefreshToken);
      useAuthStore.getState().setSession({ accessToken: token, claims });
      return token;
    } catch {
      clearStoredRefreshToken();
      clearStoredAdminProfile();
      useAuthStore.getState().clearSession();
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export function installApiClient() {
  if (installed) return;
  installed = true;

  apiHttp.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    const token = useAuthStore.getState().accessToken;
    if (token) {
      config.headers = config.headers ?? {};
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });

  apiHttp.interceptors.response.use(
    (res) => res,
    async (error: AxiosError) => {
      const status = error.response?.status;
      const original = (error.config ?? {}) as (InternalAxiosRequestConfig & { __bbRetried?: boolean });
      if (status !== 401 || !original || original.__bbRetried) throw error;

      original.__bbRetried = true;
      const newToken = await refreshAccessTokenSingleFlight();
      if (!newToken) {
        window.location.assign('/login');
        throw error;
      }

      original.headers = original.headers ?? {};
      if (original.headers instanceof AxiosHeaders) {
        original.headers.set('Authorization', `Bearer ${newToken}`);
      } else {
        (original.headers as Record<string, string>)['Authorization'] = `Bearer ${newToken}`;
      }
      return apiHttp.request(original);
    }
  );
}

export const api = apiHttp;
