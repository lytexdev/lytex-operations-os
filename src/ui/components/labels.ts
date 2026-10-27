import { t, type I18nKey } from '@/shared/i18n';
import { formatMoney, type Cents } from '@/shared/money/money';
import { formatDuration, formatLocalDate, formatLocalDateTime, parseIso } from '@/shared/date/time';
import { intlLocale } from '@/shared/i18n';

/** Translate an enum value by key prefix, falling back to the raw value. */
export function label(prefix: string, value: string | null | undefined): string {
  if (!value) return t('common.none');
  const key = `${prefix}.${value}` as I18nKey;
  const r = t(key);
  return r === key ? value : r;
}

export const money = (c: Cents | null | undefined, currency = 'EUR'): string =>
  c == null ? t('common.none') : formatMoney(c, currency, intlLocale());
export const dur = (s: number | null | undefined): string =>
  s == null ? t('common.none') : formatDuration(s);
export const date = (d: string | null | undefined): string =>
  d ? formatLocalDate(d.length > 10 ? parseIso(d) : d, intlLocale()) : t('common.none');
export const dateTime = (iso: string | null | undefined): string =>
  iso ? formatLocalDateTime(parseIso(iso), intlLocale()) : t('common.none');
export const pct = (ratio: number): string => `${Math.round(ratio * 100)} %`;
export const hours = (s: number): string =>
  (s / 3600).toLocaleString(intlLocale(), { maximumFractionDigits: 1, minimumFractionDigits: 1 });

/** Makes a `$derived` depend on a store value (e.g. the index version) and computes `fn`. */
export const dep = <T>(_trigger: unknown, fn: () => T): T => fn();
