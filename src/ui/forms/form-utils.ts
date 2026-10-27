import { parseMoney } from '@/shared/money/money';
import { parseDuration, isIsoDate, localDateTime } from '@/shared/date/time';
import { msg } from '@/shared/i18n';

/** Field-level parsing for forms. Each returns {value} or {error} with a German message. */
export type Parsed<T> = { value: T; error?: undefined } | { value?: undefined; error: string };

export function moneyField(
  input: string,
  opts: { required?: boolean; min?: number } = {},
): Parsed<number | null> {
  if (!input.trim())
    return opts.required
      ? { error: msg('Betrag ist erforderlich', 'Amount is required') }
      : { value: null };
  const v = parseMoney(input);
  if (v === null)
    return {
      error: msg('Ungültiger Betrag (z. B. 70 oder 70,50)', 'Invalid amount (e.g. 70 or 70.50)'),
    };
  if (opts.min !== undefined && v < opts.min)
    return {
      error: msg(
        `Betrag muss mindestens ${opts.min / 100} sein`,
        `Amount must be at least ${opts.min / 100}`,
      ),
    };
  return { value: v };
}

export function durationField(
  input: string,
  opts: { required?: boolean; allowNegative?: boolean } = {},
): Parsed<number | null> {
  const s = input.trim();
  if (!s)
    return opts.required
      ? { error: msg('Dauer ist erforderlich', 'Duration is required') }
      : { value: null };
  const neg = opts.allowNegative && s.startsWith('-');
  const v = parseDuration(neg ? s.slice(1) : s);
  if (v === null)
    return {
      error: msg(
        'Ungültige Dauer (z. B. 1:30, 1,5 oder 90m)',
        'Invalid duration (e.g. 1:30, 1.5 or 90m)',
      ),
    };
  return { value: neg ? -v : v };
}

export function hoursField(input: string): Parsed<number | null> {
  return durationField(
    input.includes(':') || /[hm]$/i.test(input.trim())
      ? input
      : input.trim()
        ? `${input.trim()}h`
        : '',
  );
}

export function dateField(input: string, required = false): Parsed<string | null> {
  if (!input)
    return required
      ? { error: msg('Datum ist erforderlich', 'Date is required') }
      : { value: null };
  return isIsoDate(input) ? { value: input } : { error: msg('Ungültiges Datum', 'Invalid date') };
}

export function dateTimeField(date: string, time: string): Parsed<number> {
  if (!isIsoDate(date)) return { error: msg('Ungültiges Datum', 'Invalid date') };
  const v = localDateTime(date, time);
  if (v === null)
    return {
      error: msg(
        'Ungültige Uhrzeit (HH:MM) oder Zeit existiert wegen Zeitumstellung nicht',
        'Invalid time (HH:MM) or time does not exist due to a DST change',
      ),
    };
  return { value: v };
}

export function percentBpField(input: string): Parsed<number> {
  if (!input.trim()) return { value: 0 };
  const m = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(input.trim());
  if (!m) return { error: msg('Ungültiger Prozentwert', 'Invalid percentage') };
  const bp = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  if (bp > 10000) return { error: msg('Maximal 100 %', 'At most 100 %') };
  return { value: bp };
}

export function quantityMilliField(input: string): Parsed<number> {
  const m = /^(-?\d+)(?:[.,](\d{1,3}))?$/.exec(input.trim());
  if (!m) return { error: msg('Ungültige Menge', 'Invalid quantity') };
  const sign = m[1]!.startsWith('-') ? -1 : 1;
  return { value: sign * (Math.abs(Number(m[1])) * 1000 + Number((m[2] ?? '').padEnd(3, '0'))) };
}

export function emailField(input: string): Parsed<string> {
  const s = input.trim();
  if (!s) return { value: '' };
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
    ? { value: s }
    : { error: msg('Ungültige E-Mail-Adresse', 'Invalid email address') };
}

export function urlField(input: string): Parsed<string> {
  const s = input.trim();
  if (!s) return { value: '' };
  const withProto = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withProto);
    if (!u.hostname.includes('.')) return { error: msg('Ungültige Website', 'Invalid website') };
    return { value: withProto };
  } catch {
    return { error: msg('Ungültige Website', 'Invalid website') };
  }
}

export function tagsField(input: string): string[] {
  return input
    .split(',')
    .map((s) => s.trim().replace(/^#/, ''))
    .filter(Boolean);
}

export function centsToInput(c: number | null | undefined): string {
  if (c == null) return '';
  const neg = c < 0;
  const a = Math.abs(c);
  return `${neg ? '-' : ''}${Math.floor(a / 100)},${String(a % 100).padStart(2, '0')}`;
}

export function secondsToInput(s: number | null | undefined): string {
  if (s == null) return '';
  const neg = s < 0;
  const a = Math.abs(s);
  return `${neg ? '-' : ''}${Math.floor(a / 3600)}:${String(Math.floor((a % 3600) / 60)).padStart(2, '0')}`;
}

/** Collects field errors; `ok` is false if any field failed. */
export class FormErrors {
  errors: Record<string, string> = {};
  take<T>(field: string, p: Parsed<T>): T {
    if (p.error !== undefined) {
      this.errors[field] = p.error;
      return undefined as T;
    }
    return p.value as T;
  }
  require(field: string, value: string, message = msg('Pflichtfeld', 'Required')): string {
    if (!value.trim()) this.errors[field] = message;
    return value.trim();
  }
  get ok(): boolean {
    return Object.keys(this.errors).length === 0;
  }
}

export type DurationUnit = 'h' | 'm';

/** Duration entered as number + unit (hours may be decimal "1,5" or "1:30"; minutes integer/decimal). */
export function unitDurationField(
  input: string,
  unit: DurationUnit,
  required = false,
): Parsed<number | null> {
  const s = input.trim().replace(',', '.');
  if (!s)
    return required
      ? { error: msg('Dauer ist erforderlich', 'Duration is required') }
      : { value: null };
  if (unit === 'h' && /^\d+:\d{1,2}$/.test(s)) {
    const [h, m] = s.split(':').map(Number) as [number, number];
    if (m > 59) return { error: msg('Ungültige Dauer', 'Invalid duration') };
    return { value: h * 3600 + m * 60 };
  }
  if (!/^\d+(\.\d+)?$/.test(s))
    return {
      error:
        unit === 'h'
          ? msg('Ungültige Stundenangabe (z. B. 1,5 oder 1:30)', 'Invalid hours (e.g. 1.5 or 1:30)')
          : msg('Ungültige Minutenangabe (z. B. 45)', 'Invalid minutes (e.g. 45)'),
    };
  const v = Math.round(Number(s) * (unit === 'h' ? 3600 : 60));
  return { value: v };
}

/** Pick a natural unit for an existing duration: whole/large values in hours, otherwise minutes. */
export function secondsToUnitInput(
  seconds: number | null | undefined,
  fallback: DurationUnit = 'h',
): { text: string; unit: DurationUnit } {
  if (seconds == null) return { text: '', unit: fallback };
  if (seconds % 3600 === 0 || (seconds >= 3600 && seconds % 900 === 0)) {
    return { text: String(Math.round((seconds / 3600) * 100) / 100).replace('.', ','), unit: 'h' };
  }
  return { text: String(Math.round((seconds / 60) * 100) / 100).replace('.', ','), unit: 'm' };
}

/** Insert text at the cursor of a textarea value. */
export function insertAt(
  value: string,
  start: number,
  end: number,
  text: string,
): { value: string; cursor: number } {
  const before = value.slice(0, start);
  const after = value.slice(end);
  const pre = before && !before.endsWith('\n') && text.startsWith('!') ? '\n' : '';
  const ins = pre + text;
  return { value: before + ins + after, cursor: start + ins.length };
}
