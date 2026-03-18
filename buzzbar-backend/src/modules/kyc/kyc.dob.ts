import type { DobParseResult, DobSource } from './kyc.types.js';
import NepaliDateConverter from 'nepali-date-converter';

const NepaliDate: any = (NepaliDateConverter as any).default ?? NepaliDateConverter;
const DEVANAGARI_DIGIT_MAP: Record<string, string> = {
  '०': '0',
  '१': '1',
  '२': '2',
  '३': '3',
  '४': '4',
  '५': '5',
  '६': '6',
  '७': '7',
  '८': '8',
  '९': '9'
};
const MONTH_MAP: Record<string, number> = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  SEPT: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12
};

type DateCandidate = {
  year: number;
  month: number;
  day: number;
  matched: string;
  sourceHint?: DobSource;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function toUtcDate(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day));
}

export function normalizeDevanagariDigits(raw: string) {
  return String(raw ?? '').replace(/[०-९]/g, (char) => DEVANAGARI_DIGIT_MAP[char] ?? char);
}

function isValidYmd(year: number, month: number, day: number) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1900 || year > 2200) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const d = toUtcDate(year, month, day);
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

export function hasStrongBsContext(raw: string) {
  const normalized = normalizeDevanagariDigits(raw);
  const rawUpper = normalized.toUpperCase();
  if (/\bBS\b/.test(rawUpper) || /\bB\.S\.?\b/.test(rawUpper)) return true;
  return /(वि\.?\s*सं|वि\s*सं|जन्म\s*मिति|जन्ममिति|जन्म|नागरिकता|मिति)/u.test(normalized);
}

function detectSource(rawUpper: string, year: number, strongBsContext: boolean): DobSource {
  if (strongBsContext || /\bBS\b/.test(rawUpper) || /\bB\.S\.\b/.test(rawUpper) || rawUpper.includes('वि') || rawUpper.includes('सं')) {
    return 'BS';
  }
  if (year >= 2030) return 'BS';
  return 'AD';
}

function parseMonthToken(raw: string) {
  return MONTH_MAP[raw.replace(/[^a-z]/gi, '').toUpperCase()];
}

export function findMonthNameDateCandidate(raw: string): DateCandidate | null {
  const s = normalizeDevanagariDigits(raw).replace(/\s+/g, ' ').trim();

  const dmyMonth = s.match(/\b(\d{1,2})[\s./-]*([A-Za-z]{3,9})[\s./-]*(\d{4})\b/);
  if (dmyMonth) {
    const month = parseMonthToken(dmyMonth[2]);
    if (month) {
      return {
        year: Number(dmyMonth[3]),
        month,
        day: Number(dmyMonth[1]),
        matched: `${dmyMonth[1]} ${dmyMonth[2].toUpperCase()} ${dmyMonth[3]}`,
        sourceHint: 'AD'
      };
    }
  }

  const ymdMonth = s.match(/\b(\d{4})[\s./-]*([A-Za-z]{3,9})[\s./-]*(\d{1,2})\b/);
  if (ymdMonth) {
    const month = parseMonthToken(ymdMonth[2]);
    if (month) {
      return {
        year: Number(ymdMonth[1]),
        month,
        day: Number(ymdMonth[3]),
        matched: `${ymdMonth[1]} ${ymdMonth[2].toUpperCase()} ${ymdMonth[3]}`,
        sourceHint: 'AD'
      };
    }
  }

  return null;
}

function findDateCandidate(raw: string): DateCandidate | null {
  const s = normalizeDevanagariDigits(raw).replace(/\s+/g, ' ').trim();

  const monthName = findMonthNameDateCandidate(s);
  if (monthName) return monthName;

  const ymd = s.match(/\b(\d{1,4})[./-](\d{1,2})[./-](\d{1,2})\b/);
  if (ymd) {
    return { year: Number(ymd[1]), month: Number(ymd[2]), day: Number(ymd[3]), matched: ymd[0] };
  }

  const dmy = s.match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{1,4})\b/);
  if (dmy) {
    return { year: Number(dmy[3]), month: Number(dmy[2]), day: Number(dmy[1]), matched: dmy[0] };
  }

  return null;
}

export function extractDobCandidateFromText(text: string): string | undefined {
  const raw = normalizeDevanagariDigits(String(text ?? ''));
  if (!raw.trim()) return undefined;

  const keyword = /(DOB|D\.O\.B|DATE\s+OF\s+BIRTH|BIRTH\s+DATE)/i;
  const kw = raw.match(keyword);
  if (kw?.index !== undefined) {
    const slice = raw.slice(kw.index, kw.index + 120);
    const c = findDateCandidate(slice);
    if (c) return `${c.matched}${c.sourceHint === 'AD' ? '' : hasStrongBsContext(slice) ? ' BS' : ''}`.trim();
  }

  const c = findDateCandidate(raw);
  if (c) return `${c.matched}${c.sourceHint === 'AD' ? '' : hasStrongBsContext(raw) ? ' BS' : ''}`.trim();
  return undefined;
}

export function parseDobRaw(raw: string | undefined | null): DobParseResult {
  const errors: string[] = [];
  const safe = normalizeDevanagariDigits(String(raw ?? '')).trim();
  if (!safe) {
    return { dobSource: 'UNKNOWN', confidence: 0, errors: ['missing_dob'] };
  }

  const candidate = findDateCandidate(safe);
  if (!candidate) {
    return { dobSource: 'UNKNOWN', confidence: 0, errors: ['no_date_pattern_found'] };
  }

  const rawUpper = safe.toUpperCase();
  const strongBsContext = hasStrongBsContext(safe);
  const dobSource = candidate.sourceHint === 'AD' ? 'AD' : detectSource(rawUpper, candidate.year, strongBsContext);

  if (dobSource === 'AD') {
    if (!isValidYmd(candidate.year, candidate.month, candidate.day)) {
      return { dobSource: 'AD', confidence: 0, errors: ['invalid_ad_date'] };
    }
    const confidence = rawUpper.includes('DOB') || rawUpper.includes('DATE OF BIRTH') ? 1 : 0.8;
    return {
      dobAD: toUtcDate(candidate.year, candidate.month, candidate.day),
      dobBS: undefined,
      dobSource: 'AD',
      confidence,
      errors
    };
  }

  // BS -> AD
  if (candidate.year < 1000) {
    errors.push(strongBsContext ? 'truncated_bs_year' : 'invalid_bs_year');
    return { dobSource: 'BS', confidence: 0, errors };
  }
  if (candidate.year < 2000 || candidate.year > 2200) {
    errors.push('invalid_bs_year');
    return { dobSource: 'BS', confidence: 0, errors };
  }

  const bs = `${candidate.year}-${pad2(clamp(candidate.month, 1, 12))}-${pad2(clamp(candidate.day, 1, 32))}`;
  try {
    const adObj = new NepaliDate(candidate.year, candidate.month - 1, candidate.day).getAD();
    const adYear = Number(adObj?.year);
    const adMonth = Number(adObj?.month) + 1; // library uses 0-indexed month in getAD()
    const adDay = Number(adObj?.date);
    if (!isValidYmd(adYear, adMonth, adDay)) {
      errors.push('bs_to_ad_invalid_result');
      return { dobSource: 'BS', confidence: 0, errors };
    }
    const confidence = rawUpper.includes('DOB') || rawUpper.includes('DATE OF BIRTH') ? 0.9 : 0.7;
    return {
      dobAD: toUtcDate(adYear, adMonth, adDay),
      dobBS: bs,
      dobSource: 'BS',
      confidence,
      errors
    };
  } catch {
    errors.push('bs_to_ad_failed');
    return { dobSource: 'BS', confidence: 0, errors };
  }
}
