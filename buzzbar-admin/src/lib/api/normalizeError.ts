export type ApiErrorShape = {
  message: string;
  errorCode?: string;
  details?: unknown;
  requestId?: string;
};

const FRIENDLY_MESSAGES: Record<string, string> = {
  PAYMENT_PROVIDER_NOT_SUPPORTED: 'This payment provider is not supported by the backend.',
  PAYMENT_TRANSACTION_NOT_FOUND: 'The payment transaction could not be found.',
  PAYMENT_CONFIRMATION_FAILED: 'Payment confirmation failed before reaching a final state.',
  PAYMENT_ALREADY_TERMINAL: 'This payment is already in a final state.',
  INVALID_LIMIT: 'The requested page size is not allowed.',
  INVALID_DATE: 'One of the supplied dates is invalid.',
  ADMIN_FORBIDDEN: 'Your current session does not have access to this admin view.',
  PROMO_CODE_ALREADY_EXISTS: 'That promotion code is already in use.',
  VALIDATION_ERROR: 'The submitted form data is invalid.',
  INVALID_ID: 'One of the supplied identifiers is invalid.'
};

export function normalizeApiError(err: unknown): ApiErrorShape {
  const anyErr = err as { message?: unknown; response?: { data?: unknown } } | null;
  const data = (anyErr?.response?.data ?? null) as { message?: unknown; errorCode?: unknown; requestId?: unknown; details?: unknown } | null;
  const errorCode = typeof data?.errorCode === 'string' ? data.errorCode : undefined;
  const rawMessage =
    typeof data?.message === 'string'
      ? data.message
      : typeof anyErr?.message === 'string'
        ? String(anyErr.message)
        : 'Unknown error';
  const message = errorCode && FRIENDLY_MESSAGES[errorCode] ? FRIENDLY_MESSAGES[errorCode] : rawMessage;
  const requestId = typeof data?.requestId === 'string' ? data.requestId : undefined;
  const details = data?.details;
  return { message, errorCode, requestId, details };
}
