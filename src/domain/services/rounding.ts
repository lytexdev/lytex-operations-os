import { msg } from '@/shared/i18n';
export type RoundingMode = 'none' | 'up' | 'nearest' | 'down';

export interface RoundingRule {
  unit_minutes: number;
  mode: RoundingMode;
}

/** Round a duration to the billing unit. Rounding is applied per time entry and documented on the batch. */
export function roundSeconds(seconds: number, rule: RoundingRule): number {
  if (rule.mode === 'none' || rule.unit_minutes <= 0) return seconds;
  const unit = rule.unit_minutes * 60;
  const sign = seconds < 0 ? -1 : 1;
  const abs = Math.abs(seconds);
  let units: number;
  switch (rule.mode) {
    case 'up':
      units = Math.ceil(abs / unit);
      break;
    case 'down':
      units = Math.floor(abs / unit);
      break;
    case 'nearest':
      units = Math.floor((abs + unit / 2) / unit);
      break;
  }
  return sign * units * unit;
}

export function describeRounding(rule: RoundingRule): string {
  if (rule.mode === 'none')
    return msg('Keine Rundung (sekundengenau)', 'No rounding (to the second)');
  const m = {
    up: msg('aufgerundet', 'rounded up'),
    down: msg('abgerundet', 'rounded down'),
    nearest: msg('kaufmännisch gerundet', 'rounded to nearest'),
  }[rule.mode];
  return msg(
    `Je Zeiteintrag auf ${rule.unit_minutes} Min. ${m}`,
    `Per time entry ${m} to ${rule.unit_minutes} min`,
  );
}
