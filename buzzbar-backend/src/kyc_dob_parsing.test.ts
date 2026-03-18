import { describe, expect, it } from 'vitest';
import { extractDobCandidateFromText, parseDobRaw } from './modules/kyc/kyc.dob.js';

describe('KYC DOB parsing', () => {
  it('parses month-name AD formats', () => {
    const standard = parseDobRaw('20 JUN 1978');
    expect(standard.dobSource).toBe('AD');
    expect(standard.dobAD?.toISOString()).toBe('1978-06-20T00:00:00.000Z');

    const inverted = parseDobRaw('1978 JUN 20');
    expect(inverted.dobSource).toBe('AD');
    expect(inverted.dobAD?.toISOString()).toBe('1978-06-20T00:00:00.000Z');
  });

  it('normalizes mixed-script OCR and parses AD dates', () => {
    const parsed = parseDobRaw('DOB: २० JUN 1978');
    expect(parsed.dobSource).toBe('AD');
    expect(parsed.dobAD?.toISOString()).toBe('1978-06-20T00:00:00.000Z');
  });

  it('normalizes devanagari digits for BS parsing', () => {
    const parsed = parseDobRaw('२०४६-०४-०८ BS');
    expect(parsed.dobSource).toBe('BS');
    expect(parsed.dobBS).toBe('2046-04-08');
    expect(parsed.dobAD).toBeDefined();
  });

  it('marks truncated BS year instead of misclassifying as AD', () => {
    const raw = extractDobCandidateFromText('जन्म मिति 8-4-0086');
    expect(raw).toBe('8-4-0086 BS');

    const parsed = parseDobRaw(raw);
    expect(parsed.dobSource).toBe('BS');
    expect(parsed.dobAD).toBeUndefined();
    expect(parsed.errors).toContain('truncated_bs_year');
  });
});
