/**
 * Money is always represented as integer minor units (cents). Floating point is never used for
 * final amounts. All rounding is half-up away from zero unless stated otherwise.
 */
export type Cents = number;

export function assertCents(value: number, label = 'amount'): Cents {
  if (!Number.isSafeInteger(value))
    throw new RangeError(`${label} must be an integer amount of cents, got ${value}`);
  return value;
}

/** Integer division rounding half away from zero. */
export function divRoundHalfUp(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) {
    throw new RangeError('divRoundHalfUp requires safe integers');
  }
  if (denominator === 0) throw new RangeError('Division by zero');
  const sign = Math.sign(numerator) * Math.sign(denominator);
  const n = Math.abs(numerator);
  const d = Math.abs(denominator);
  const q = Math.floor(n / d);
  const r = n - q * d;
  const rounded = r * 2 >= d ? q + 1 : q;
  return sign * rounded;
}

/** Amount for a duration at an hourly rate: seconds × cents/hour ÷ 3600, rounded half-up. */
export function amountForSeconds(seconds: number, hourlyRateCents: Cents): Cents {
  assertCents(hourlyRateCents, 'rate');
  if (!Number.isSafeInteger(seconds) || seconds < 0)
    throw new RangeError(`Invalid seconds: ${seconds}`);
  const product = seconds * hourlyRateCents;
  if (!Number.isSafeInteger(product)) {
    // Fall back to BigInt for extreme values.
    const big = BigInt(seconds) * BigInt(hourlyRateCents);
    const q = big / 3600n;
    const r = big % 3600n;
    return Number(r * 2n >= 3600n ? q + 1n : q);
  }
  return divRoundHalfUp(product, 3600);
}

/** quantity is expressed in thousandths (e.g. 1.5 h = 1500) to stay in integers. */
export function lineTotal(quantityMilli: number, unitPriceCents: Cents): Cents {
  assertCents(unitPriceCents, 'unit price');
  if (!Number.isSafeInteger(quantityMilli))
    throw new RangeError('quantity must be integer thousandths');
  return divRoundHalfUp(quantityMilli * unitPriceCents, 1000);
}

/** Percentage discount in basis points (10000 = 100 %). Returns the (positive) discount amount. */
export function percentOf(amount: Cents, basisPoints: number): Cents {
  return divRoundHalfUp(amount * basisPoints, 10000);
}

export function sumCents(values: readonly Cents[]): Cents {
  let total = 0;
  for (const v of values) total += assertCents(v);
  return assertCents(total, 'sum');
}

/**
 * Parse a user-entered amount like "70", "70,5", "1.234,56", "1234.56" into cents.
 * Returns null for unparseable input. Never goes through floating point.
 */
export function parseMoney(input: string): Cents | null {
  let s = input.trim().replace(/\s|€|EUR/gi, '');
  if (s === '') return null;
  const negative = s.startsWith('-');
  if (negative) s = s.slice(1);
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let decimalSep: string | null = null;
  if (lastComma >= 0 && lastDot >= 0) decimalSep = lastComma > lastDot ? ',' : '.';
  else if (lastComma >= 0) decimalSep = s.length - lastComma - 1 <= 2 ? ',' : null;
  else if (lastDot >= 0) decimalSep = s.length - lastDot - 1 <= 2 ? '.' : null;
  let intPart = s;
  let fracPart = '';
  if (decimalSep) {
    const idx = s.lastIndexOf(decimalSep);
    intPart = s.slice(0, idx);
    fracPart = s.slice(idx + 1);
  }
  intPart = intPart.replace(/[.,]/g, '');
  if (!/^\d+$/.test(intPart || '0') || !/^\d{0,2}$/.test(fracPart)) return null;
  const cents = Number(intPart || '0') * 100 + Number((fracPart + '00').slice(0, 2));
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

/** Format cents as a localized currency string. Formatting only – never feed the result back into math. */
export function formatMoney(cents: Cents, currency = 'EUR', locale = 'de-DE'): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const euros = Math.floor(abs / 100);
  const rest = abs % 100;
  const intStr = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(euros);
  const dec = locale.startsWith('de') ? ',' : '.';
  const symbol = currency === 'EUR' ? '€' : currency;
  const num = `${negative ? '-' : ''}${intStr}${dec}${String(rest).padStart(2, '0')}`;
  return locale.startsWith('de') ? `${num} ${symbol}` : `${symbol} ${num}`;
}

/** Plain decimal string for exports, e.g. 123456 -> "1234.56" (or "1234,56"). */
export function centsToDecimalString(cents: Cents, decimalSeparator: '.' | ',' = '.'): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  return `${negative ? '-' : ''}${Math.floor(abs / 100)}${decimalSeparator}${String(abs % 100).padStart(2, '0')}`;
}
