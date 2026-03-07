import { z } from 'zod';
import type { MockPaymentMode, PaymentProviderId, PaymentTransactionStatus } from './payments.types.js';

export type PaymentProviderInitResult = {
  status: Extract<PaymentTransactionStatus, 'INITIATED' | 'PENDING'>;
  providerReference?: string;
  responsePayload?: unknown;
};

export type PaymentProviderConfirmResult = {
  status: Extract<PaymentTransactionStatus, 'PENDING' | 'SUCCESS' | 'FAILED'>;
  providerReference?: string;
  responsePayload?: unknown;
  failureReason?: string;
};

export type PaymentProvider = {
  id: PaymentProviderId;
  init(opts: { orderId: string; amount: number; currency: string }): Promise<PaymentProviderInitResult>;
  confirm(opts: { transactionStatus: PaymentTransactionStatus; payload: unknown }): Promise<PaymentProviderConfirmResult>;
};

const mockConfirmPayloadSchema = z
  .object({
    mode: z.enum(['SUCCESS', 'FAILED', 'PENDING_THEN_SUCCESS', 'PENDING_THEN_FAILED']).optional()
  })
  .passthrough();

const MockProvider: PaymentProvider = {
  id: 'MOCK',
  async init(opts) {
    return {
      status: 'INITIATED',
      providerReference: `mock_${opts.orderId}`,
      responsePayload: { provider: 'MOCK', next: 'confirm', amount: opts.amount, currency: opts.currency }
    };
  },
  async confirm(opts) {
    const parsed = mockConfirmPayloadSchema.safeParse(opts.payload);
    const mode: MockPaymentMode = parsed.success ? (parsed.data.mode ?? 'SUCCESS') : 'SUCCESS';

    if (mode === 'SUCCESS') return { status: 'SUCCESS', responsePayload: { provider: 'MOCK', result: 'SUCCESS' } };
    if (mode === 'FAILED') return { status: 'FAILED', failureReason: 'mock_failed', responsePayload: { provider: 'MOCK', result: 'FAILED' } };

    if (mode === 'PENDING_THEN_SUCCESS') {
      if (opts.transactionStatus === 'INITIATED') return { status: 'PENDING', responsePayload: { provider: 'MOCK', result: 'PENDING' } };
      if (opts.transactionStatus === 'PENDING') return { status: 'SUCCESS', responsePayload: { provider: 'MOCK', result: 'SUCCESS' } };
      return { status: 'SUCCESS', responsePayload: { provider: 'MOCK', result: 'SUCCESS' } };
    }

    // PENDING_THEN_FAILED
    if (opts.transactionStatus === 'INITIATED') return { status: 'PENDING', responsePayload: { provider: 'MOCK', result: 'PENDING' } };
    if (opts.transactionStatus === 'PENDING') return { status: 'FAILED', failureReason: 'mock_failed', responsePayload: { provider: 'MOCK', result: 'FAILED' } };
    return { status: 'FAILED', failureReason: 'mock_failed', responsePayload: { provider: 'MOCK', result: 'FAILED' } };
  }
};

export function normalizeProviderId(raw: string): PaymentProviderId | null {
  const p = raw.trim().toUpperCase();
  if (p === 'MOCK' || p === 'ESEWA' || p === 'KHALTI') return p as PaymentProviderId;
  return null;
}

export function getPaymentProvider(providerId: PaymentProviderId): PaymentProvider | null {
  if (providerId === 'MOCK') return MockProvider;
  return null;
}

