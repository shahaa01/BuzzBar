export type ApiErrorShape = {
  message: string;
  errorCode?: string;
  details?: unknown;
  requestId?: string;
};

export function normalizeApiError(err: unknown): ApiErrorShape {
  const anyErr = err as { message?: unknown; response?: { data?: unknown } } | null;
  const data = (anyErr?.response?.data ?? null) as { message?: unknown; errorCode?: unknown; requestId?: unknown; details?: unknown } | null;
  const message =
    typeof data?.message === 'string'
      ? data.message
      : typeof anyErr?.message === 'string'
        ? String(anyErr.message)
        : 'Unknown error';
  const errorCode = typeof data?.errorCode === 'string' ? data.errorCode : undefined;
  const requestId = typeof data?.requestId === 'string' ? data.requestId : undefined;
  const details = data?.details;
  return { message, errorCode, requestId, details };
}
