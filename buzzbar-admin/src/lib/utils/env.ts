export function getApiBaseUrl() {
  const raw = import.meta.env.VITE_API_BASE_URL;
  return (raw ?? '').trim().replace(/\/+$/, '');
}
