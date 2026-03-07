import type { DobParseResult, KycAutoDecision } from './kyc.types.js';
import { extractDobCandidateFromText, parseDobRaw } from './kyc.dob.js';

function getYmdInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
  // en-CA => YYYY-MM-DD
  const m = parts.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error('Failed to compute date parts');
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function ageYearsAt(opts: { dob: Date; at: Date; timeZone: string }) {
  const dobY = opts.dob.getUTCFullYear();
  const dobM = opts.dob.getUTCMonth() + 1;
  const dobD = opts.dob.getUTCDate();
  const now = getYmdInTimeZone(opts.at, opts.timeZone);

  let age = now.year - dobY;
  if (now.month < dobM || (now.month === dobM && now.day < dobD)) age -= 1;
  return age;
}

function diffDays(a: Date, b: Date) {
  const ms = Math.abs(a.getTime() - b.getTime());
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

function normalizeConfidence(raw: unknown) {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export type KycDecisionEngineInput = {
  legalAgeMin: number;
  timezone: string;
  evaluatedAt: Date;
  confidenceThreshold: number;
  dobToleranceDays: number;
  client: { ocrText?: string; dobRaw?: string; confidence?: number };
  server: { ocrText?: string; dobRaw?: string; confidence?: number };
};

export type KycDecisionEngineOutput = {
  autoDecision: KycAutoDecision;
  autoDecisionReason: string;
  clientDobRaw?: string;
  serverDobRaw?: string;
  clientParsed: DobParseResult;
  serverParsed: DobParseResult;
  clientAgeYears?: number;
  serverAgeYears?: number;
  clientAgeValid: boolean;
  serverAgeValid: boolean;
  dobDifferenceDays?: number;
  ageYears?: number;
  parseConfidence: number;
  parseErrors: string[];
};

export function decideKyc(input: KycDecisionEngineInput): KycDecisionEngineOutput {
  const clientConfidence = normalizeConfidence(input.client.confidence);
  const serverConfidence = normalizeConfidence(input.server.confidence);

  const clientDobRaw =
    (input.client.dobRaw ?? '').trim() ||
    extractDobCandidateFromText(input.client.ocrText ?? '');
  const serverDobRaw =
    (input.server.dobRaw ?? '').trim() ||
    extractDobCandidateFromText(input.server.ocrText ?? '');

  const clientParsed = parseDobRaw(clientDobRaw);
  const serverParsed = parseDobRaw(serverDobRaw);

  const parseErrors = [...clientParsed.errors, ...serverParsed.errors];
  const parseConfidence = Math.min(clientParsed.confidence, serverParsed.confidence);

  const clientAgeYears = clientParsed.dobAD
    ? ageYearsAt({ dob: clientParsed.dobAD, at: input.evaluatedAt, timeZone: input.timezone })
    : undefined;
  const serverAgeYears = serverParsed.dobAD
    ? ageYearsAt({ dob: serverParsed.dobAD, at: input.evaluatedAt, timeZone: input.timezone })
    : undefined;

  const clientAgeValid = clientAgeYears !== undefined && clientAgeYears >= input.legalAgeMin;
  const serverAgeValid = serverAgeYears !== undefined && serverAgeYears >= input.legalAgeMin;

  const dobDifferenceDays =
    clientParsed.dobAD && serverParsed.dobAD ? diffDays(clientParsed.dobAD, serverParsed.dobAD) : undefined;

  const confidentEnough = clientConfidence >= input.confidenceThreshold && serverConfidence >= input.confidenceThreshold;

  // Never auto-reject; anything uncertain (including underage signals) => needs review.
  if (
    clientParsed.dobAD &&
    serverParsed.dobAD &&
    clientAgeValid &&
    serverAgeValid &&
    dobDifferenceDays !== undefined &&
    dobDifferenceDays <= input.dobToleranceDays &&
    confidentEnough
  ) {
    return {
      autoDecision: 'auto_verified',
      autoDecisionReason: 'and_gate_passed',
      clientDobRaw: clientDobRaw || undefined,
      serverDobRaw: serverDobRaw || undefined,
      clientParsed,
      serverParsed,
      clientAgeYears,
      serverAgeYears,
      clientAgeValid,
      serverAgeValid,
      dobDifferenceDays,
      ageYears: serverAgeYears ?? clientAgeYears,
      parseConfidence,
      parseErrors
    };
  }

  const reasons: string[] = [];
  if (!clientParsed.dobAD) reasons.push('client_dob_unparsed');
  if (!serverParsed.dobAD) reasons.push('server_dob_unparsed');
  if (!confidentEnough) reasons.push('low_confidence');
  if (dobDifferenceDays === undefined) reasons.push('dob_difference_unknown');
  if (dobDifferenceDays !== undefined && dobDifferenceDays > input.dobToleranceDays) reasons.push('dob_mismatch');
  if (clientParsed.dobAD && !clientAgeValid) reasons.push('client_underage_signal');
  if (serverParsed.dobAD && !serverAgeValid) reasons.push('server_underage_signal');
  if (reasons.length === 0) reasons.push('needs_review');

  return {
    autoDecision: 'needs_review',
    autoDecisionReason: reasons.join('|'),
    clientDobRaw: clientDobRaw || undefined,
    serverDobRaw: serverDobRaw || undefined,
    clientParsed,
    serverParsed,
    clientAgeYears,
    serverAgeYears,
    clientAgeValid,
    serverAgeValid,
    dobDifferenceDays,
    ageYears: serverAgeYears ?? clientAgeYears,
    parseConfidence,
    parseErrors
  };
}

