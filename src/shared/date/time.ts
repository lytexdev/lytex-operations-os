/**
 * Time utilities. Internally all instants are ISO-8601 UTC strings (`…Z`) or epoch milliseconds.
 * Calendar math for "days", "weeks" and "months" is done in the user's local timezone so that
 * daylight-saving transitions are handled by the platform's Date implementation.
 */
export type IsoInstant = string;
export type IsoDate = string; // YYYY-MM-DD (local calendar date)

export interface Clock {
  /** Wall clock, epoch ms. May jump (NTP, manual changes, suspend). */
  now(): number;
  /** Monotonic clock in ms, only meaningful within one process lifetime. */
  monotonic(): number;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  monotonic: () =>
    typeof performance !== 'undefined'
      ? performance.now()
      : Number(process.hrtime.bigint() / 1000000n),
};

export function toIso(ms: number): IsoInstant {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function parseIso(value: string): number {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new Error(`Invalid timestamp: ${value}`);
  return ms;
}

export function isIsoInstant(value: unknown): value is IsoInstant {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/** Local calendar date of an instant. */
export function localDate(ms: number): IsoDate {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/** Epoch ms of local midnight at the start of the given local date. DST-safe. */
export function startOfLocalDay(date: IsoDate): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const dt = new Date(y, m - 1, d + days, 12); // noon avoids DST edge cases
  return localDate(dt.getTime());
}

/** Add months, clamping to the last day of the target month (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(date: IsoDate, months: number, preferredDay?: number): IsoDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const day = preferredDay ?? d;
  const target = new Date(y, m - 1 + months, 1, 12);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0, 12).getDate();
  target.setDate(Math.min(day, lastDay));
  return localDate(target.getTime());
}

export function daysBetween(a: IsoDate, b: IsoDate): number {
  const utc = (v: IsoDate): number => {
    const [y, m, d] = v.split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(b) - utc(a)) / 86400000);
}

/** Monday-based ISO week start for a local date. */
export function startOfWeek(date: IsoDate): IsoDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const dt = new Date(y, m - 1, d, 12);
  const dow = (dt.getDay() + 6) % 7;
  return addDays(date, -dow);
}

export function startOfMonth(date: IsoDate): IsoDate {
  return `${date.slice(0, 7)}-01`;
}

/** Combine a local date and local "HH:MM" time into an epoch ms. Returns null for non-existent times (DST gap). */
export function localDateTime(date: IsoDate, time: string): number | null {
  const tm = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!tm || !isIsoDate(date)) return null;
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const hh = Number(tm[1]);
  const mm = Number(tm[2]);
  if (hh > 23 || mm > 59) return null;
  const dt = new Date(y, m - 1, d, hh, mm, 0, 0);
  if (dt.getHours() !== hh || dt.getMinutes() !== mm) return null; // skipped by DST
  return dt.getTime();
}

export function formatLocalTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatLocalDate(dateOrMs: IsoDate | number, locale = 'de-DE'): string {
  const ms = typeof dateOrMs === 'number' ? dateOrMs : startOfLocalDay(dateOrMs) + 12 * 3600_000;
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(ms));
}

export function formatLocalDateTime(ms: number, locale = 'de-DE'): string {
  return `${formatLocalDate(ms, locale)} ${formatLocalTime(ms)}`;
}

/** 5400 -> "1:30"; with seconds -> "1:30:00". */
export function formatDuration(seconds: number, withSeconds = false): string {
  const neg = seconds < 0;
  const s = Math.abs(Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${neg ? '-' : ''}${h}:${pad(m)}${withSeconds ? `:${pad(sec)}` : ''}`;
}

/** Decimal hours with two decimals for display only, e.g. 5400 -> "1,50". */
export function formatHours(seconds: number, locale = 'de-DE'): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(seconds / 3600);
}

/** Parse "1:30", "1,5", "1.5h", "90m", "90" (minutes) into seconds. */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, '');
  if (s === '') return null;
  let m = /^(\d+):(\d{1,2})$/.exec(s);
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60;
  m = /^(\d+)(?:[.,](\d+))?h$/.exec(s);
  if (m) return hoursToSeconds(m[1]!, m[2]);
  m = /^(\d+)m(in)?$/.exec(s);
  if (m) return Number(m[1]) * 60;
  m = /^(\d+)[.,](\d+)$/.exec(s);
  if (m) return hoursToSeconds(m[1]!, m[2]);
  m = /^(\d+)$/.exec(s);
  if (m) return Number(m[1]) * 60;
  return null;
}

function hoursToSeconds(whole: string, frac: string | undefined): number {
  const f = (frac ?? '').slice(0, 4).padEnd(4, '0');
  return Number(whole) * 3600 + Math.round((Number(f) * 3600) / 10000);
}

export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}
