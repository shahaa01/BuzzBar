import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

const TESSERACT_TSV = ['level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext', '5\t1\t1\t1\t1\t1\t0\t0\t0\t0\t95\tDOB', '5\t1\t1\t1\t1\t2\t0\t0\t0\t0\t95\t20', '5\t1\t1\t1\t1\t3\t0\t0\t0\t0\t95\tJUN', '5\t1\t1\t1\t1\t4\t0\t0\t0\t0\t95\t1978'].join('\n');

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  delete process.env.KYC_OCR_LANGS;
  delete process.env.KYC_OCR_PSM;
  delete process.env.KYC_OCR_TIMEOUT_MS;
  delete process.env.KYC_OCR_MODE;
});

describe('KYC OCR provider', () => {
  it('uses configured languages, psm, and timeout for tesseract', async () => {
    const execFile = vi.fn((_file: string, _args: string[], _opts: Record<string, unknown>, callback: (err: Error | null, stdout?: string, stderr?: string) => void) => {
      callback(null, TESSERACT_TSV, '');
    });
    const execFileAsync = vi.fn(async (_file: string, _args: string[], _opts: Record<string, unknown>) => ({ stdout: TESSERACT_TSV, stderr: '' }));
    Object.assign(execFile, {
      [promisify.custom]: execFileAsync
    });
    vi.doMock('node:child_process', () => ({ execFile }));

    process.env.KYC_OCR_LANGS = 'eng+nep';
    process.env.KYC_OCR_PSM = '6';
    process.env.KYC_OCR_TIMEOUT_MS = '5000';

    const { TesseractOcrProvider } = await import('./modules/kyc/kyc.ocr.js');
    const provider = new TesseractOcrProvider();
    const result = await provider.recognize({ buffer: Buffer.from('x'), filename: 'sample.png' });

    expect(execFileAsync).toHaveBeenCalledTimes(1);
    const [, args, opts] = execFileAsync.mock.calls[0] as unknown as [string, string[], { timeout: number }];
    expect(args).toContain('eng+nep');
    expect(args).toContain('6');
    expect(opts.timeout).toBe(5000);
    expect(result.text).toContain('DOB');
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it('returns empty OCR result when tesseract is unavailable', async () => {
    const execFile = vi.fn((_file: string, _args: string[], _opts: Record<string, unknown>, callback: (err: Error | null, stdout?: string, stderr?: string) => void) => {
      const err = Object.assign(new Error('not found'), { code: 'ENOENT' });
      callback(err);
    });
    Object.assign(execFile, {
      [promisify.custom]: vi.fn(async () => {
        const err = Object.assign(new Error('not found'), { code: 'ENOENT' });
        throw err;
      })
    });
    vi.doMock('node:child_process', () => ({ execFile }));

    const { TesseractOcrProvider } = await import('./modules/kyc/kyc.ocr.js');
    const provider = new TesseractOcrProvider();
    const result = await provider.recognize({ buffer: Buffer.from('x'), filename: 'sample.png' });

    expect(result).toEqual({ text: '', confidence: 0 });
  });

  it('returns empty OCR result when tesseract times out', async () => {
    const execFile = vi.fn((_file: string, _args: string[], _opts: Record<string, unknown>, callback: (err: Error | null, stdout?: string, stderr?: string) => void) => {
      const err = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT', killed: true, signal: 'SIGTERM' });
      callback(err);
    });
    Object.assign(execFile, {
      [promisify.custom]: vi.fn(async () => {
        const err = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT', killed: true, signal: 'SIGTERM' });
        throw err;
      })
    });
    vi.doMock('node:child_process', () => ({ execFile }));

    const { TesseractOcrProvider } = await import('./modules/kyc/kyc.ocr.js');
    const provider = new TesseractOcrProvider();
    const result = await provider.recognize({ buffer: Buffer.from('x'), filename: 'sample.png' });

    expect(result).toEqual({ text: '', confidence: 0 });
  });

  it('uses fake provider when fake mode is configured', async () => {
    process.env.KYC_OCR_MODE = 'fake';

    const { getKycOcrProvider, FakeOcrProvider } = await import('./modules/kyc/kyc.ocr.js');
    const provider = getKycOcrProvider();

    expect(provider).toBeInstanceOf(FakeOcrProvider);
  });
});
