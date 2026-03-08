export type SavedFilterView = {
  id: string;
  name: string;
  params: Record<string, string>;
  isDefault: boolean;
  updatedAt: string;
};

function storageKey(adminId: string, moduleKey: string) {
  return `bb_admin_saved_filters:${adminId}:${moduleKey}`;
}

export function sanitizeSearchParams(searchParams: URLSearchParams, paginationKeys: string[]) {
  const blocked = new Set(paginationKeys);
  const params: Record<string, string> = {};

  for (const [key, value] of searchParams.entries()) {
    const trimmed = value.trim();
    if (!trimmed || blocked.has(key)) continue;
    params[key] = trimmed;
  }

  return params;
}

export function paramsToSearchParams(params: Record<string, string>, paginationKeys: string[]) {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (!value) continue;
    next.set(key, value);
  }
  for (const key of paginationKeys) {
    next.delete(key);
  }
  return next;
}

export function serializeSavedParams(params: Record<string, string>) {
  return Object.entries(params)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

export function loadSavedFilterViews(adminId: string, moduleKey: string): SavedFilterView[] {
  try {
    const raw = localStorage.getItem(storageKey(adminId, moduleKey));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const candidate = item as Partial<SavedFilterView>;
        if (!candidate.id || !candidate.name || !candidate.params || typeof candidate.params !== 'object') return null;
        return {
          id: String(candidate.id),
          name: String(candidate.name),
          params: Object.fromEntries(Object.entries(candidate.params).filter((entry): entry is [string, string] => typeof entry[0] === 'string' && typeof entry[1] === 'string')),
          isDefault: Boolean(candidate.isDefault),
          updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : new Date().toISOString()
        } satisfies SavedFilterView;
      })
      .filter((item): item is SavedFilterView => Boolean(item));
  } catch {
    return [];
  }
}

export function saveSavedFilterViews(adminId: string, moduleKey: string, views: SavedFilterView[]) {
  localStorage.setItem(storageKey(adminId, moduleKey), JSON.stringify(views));
}
