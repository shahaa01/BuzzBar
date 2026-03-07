function toTimeParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
  const m = parts.match(/^(\d{2}):(\d{2})$/);
  if (!m) throw new Error('Failed to parse time parts');
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

function parseHm(hm: string) {
  const m = hm.match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isInteger(h) || !Number.isInteger(min) || h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

export function isWithinNightHours(opts: { now: Date; start: string; end: string; timeZone: string }) {
  const startMin = parseHm(opts.start);
  const endMin = parseHm(opts.end);
  if (startMin === null || endMin === null) return false;

  const t = toTimeParts(opts.now, opts.timeZone);
  const nowMin = t.hour * 60 + t.minute;

  if (startMin < endMin) {
    return nowMin >= startMin && nowMin < endMin;
  }
  // Crosses midnight (or equal => treat as full-night)
  return nowMin >= startMin || nowMin < endMin;
}

export function getYearInTimeZone(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric' }).format(now);
  const y = Number(parts);
  return Number.isFinite(y) ? y : now.getUTCFullYear();
}

