import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { OcrResult } from './kyc.types.js';
import { createLogger } from '../../config/logger.js';

const execFileAsync = promisify(execFile);
const log = createLogger();
let loggedTesseractUnavailable = false;
let loggedTesseractTimeout = false;

export interface OcrProvider {
  recognize(opts: { buffer: Buffer; filename?: string }): Promise<OcrResult>;
}

function getOcrLanguages() {
  const value = (process.env.KYC_OCR_LANGS ?? 'eng+nep').trim();
  return value || 'eng+nep';
}

function getOcrPageSegmentationMode() {
  const raw = Number(process.env.KYC_OCR_PSM ?? '6');
  if (!Number.isFinite(raw) || raw <= 0) return '6';
  return String(Math.round(raw));
}

function getOcrTimeoutMs() {
  const raw = Number(process.env.KYC_OCR_TIMEOUT_MS ?? '5000');
  if (!Number.isFinite(raw) || raw <= 0) return 5000;
  return Math.round(raw);
}

function clamp01(n: number) {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function parseTesseractTsv(tsv: string): OcrResult {
  const lines = String(tsv ?? '').split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { text: '', confidence: 0 };

  const header = lines[0].split('\t');
  const idx = {
    level: header.indexOf('level'),
    lineNum: header.indexOf('line_num'),
    conf: header.indexOf('conf'),
    text: header.indexOf('text')
  };

  const confs: number[] = [];
  const out: string[] = [];
  let currentLine = '';

  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split('\t');
    if (cols.length !== header.length) continue;

    const level = idx.level >= 0 ? Number(cols[idx.level]) : NaN;
    if (level !== 5) continue;

    const token = idx.text >= 0 ? (cols[idx.text] ?? '').trim() : '';
    if (!token) continue;

    const lineNum = idx.lineNum >= 0 ? String(cols[idx.lineNum] ?? '') : '';
    if (currentLine !== '' && lineNum !== currentLine) {
      out.push('\n');
    }
    currentLine = lineNum;

    out.push(token);
    out.push(' ');

    const confRaw = idx.conf >= 0 ? Number(cols[idx.conf]) : NaN;
    if (Number.isFinite(confRaw) && confRaw >= 0) confs.push(confRaw);
  }

  const avg = confs.length > 0 ? confs.reduce((a, b) => a + b, 0) / confs.length : 0;
  return { text: out.join('').trim(), confidence: clamp01(avg / 100) };
}

export class FakeOcrProvider implements OcrProvider {
  async recognize(opts: { buffer: Buffer; filename?: string }): Promise<OcrResult> {
    const name = String(opts.filename ?? '').toLowerCase();
    if (name.includes('fail')) return { text: '', confidence: 0 };

    const conf = name.includes('lowconf') ? 0.3 : 0.95;
    const m = name.match(/(\d{4}-\d{2}-\d{2})/);
    const text = m ? `DOB ${m[1]}` : 'DOB 2000-01-01';
    return { text, confidence: conf };
  }
}

export class TesseractOcrProvider implements OcrProvider {
  async recognize(opts: { buffer: Buffer; filename?: string }): Promise<OcrResult> {
    const extFromName = path.extname(String(opts.filename ?? '')).toLowerCase();
    const ext = extFromName && extFromName.length <= 5 ? extFromName : '.png';
    const file = path.join(tmpdir(), `buzzbar_kyc_${randomUUID()}${ext}`);

    await fs.writeFile(file, opts.buffer);
    try {
      const { stdout } = await execFileAsync(
        'tesseract',
        [file, 'stdout', '-l', getOcrLanguages(), '--psm', getOcrPageSegmentationMode(), 'tsv'],
        {
          maxBuffer: 10 * 1024 * 1024,
          timeout: getOcrTimeoutMs()
        }
      );
      return parseTesseractTsv(stdout);
    } catch (err: any) {
      if (err?.code === 'ENOENT' && !loggedTesseractUnavailable) {
        loggedTesseractUnavailable = true;
        log.warn({ reason: 'OCR_UNAVAILABLE' }, 'tesseract CLI not found; server OCR will be skipped');
      }
      if ((err?.killed || err?.signal === 'SIGTERM' || err?.code === 'ETIMEDOUT') && !loggedTesseractTimeout) {
        loggedTesseractTimeout = true;
        log.warn({ reason: 'OCR_TIMEOUT', timeoutMs: getOcrTimeoutMs() }, 'tesseract OCR timed out; server OCR will be skipped');
      }
      return { text: '', confidence: 0 };
    } finally {
      await fs.unlink(file).catch(() => undefined);
    }
  }
}

export function getKycOcrProvider(): OcrProvider {
  const mode = (process.env.KYC_OCR_MODE ?? '').trim().toLowerCase();
  if (process.env.NODE_ENV === 'test' || mode === 'fake' || mode === 'test') return new FakeOcrProvider();
  return new TesseractOcrProvider();
}
