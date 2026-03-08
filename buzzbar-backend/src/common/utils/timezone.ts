type DateParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function partsInTimeZone(date: Date, timeZone: string): DateParts {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = dtf.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));
  const second = Number(get('second'));
  return { year, month, day, hour, minute, second };
}

function utcFromParts(p: DateParts) {
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, 0);
}

// Converts a wall-clock time in `timeZone` into a UTC Date using a small fixed-point iteration.
export function zonedTimeToUtc(opts: { year: number; month: number; day: number; hour: number; minute: number; second?: number; timeZone: string }) {
  const desired: DateParts = {
    year: opts.year,
    month: opts.month,
    day: opts.day,
    hour: opts.hour,
    minute: opts.minute,
    second: opts.second ?? 0
  };

  let guessUtcMs = utcFromParts(desired);
  for (let i = 0; i < 4; i += 1) {
    const got = partsInTimeZone(new Date(guessUtcMs), opts.timeZone);
    const diffMs = utcFromParts(desired) - utcFromParts(got);
    if (diffMs === 0) break;
    guessUtcMs += diffMs;
  }
  return new Date(guessUtcMs);
}

export function todayRangeUtc(opts: { now: Date; timeZone: string }) {
  const p = partsInTimeZone(opts.now, opts.timeZone);
  const start = zonedTimeToUtc({ year: p.year, month: p.month, day: p.day, hour: 0, minute: 0, second: 0, timeZone: opts.timeZone });
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

