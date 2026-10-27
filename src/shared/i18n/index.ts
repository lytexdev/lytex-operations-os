import { de, type I18nKey } from './de';
import { en } from './en';

export type { I18nKey };
export type Locale = 'de' | 'en';
let current: Locale = 'de';

export function setLocale(locale: Locale): void {
  current = locale;
}

export function getLocale(): Locale {
  return current;
}

export function intlLocale(): string {
  return current === 'de' ? 'de-DE' : 'en-GB';
}

/**
 * Inline bilingual text for messages that do not belong in the key dictionary (validation and
 * domain errors, generated note texts). Evaluated at call time, so the current locale applies.
 */
export function msg(de: string, en: string): string {
  return current === 'en' ? en : de;
}

/** Resolve the configured language ('auto' follows Obsidian's UI language). */
export function resolveLocale(
  setting: 'auto' | Locale,
  obsidianLanguage: string | null | undefined,
): Locale {
  if (setting === 'de' || setting === 'en') return setting;
  return (obsidianLanguage ?? '').toLowerCase().startsWith('de') ? 'de' : 'en';
}

export function t(key: I18nKey, vars: Record<string, string | number> = {}): string {
  const raw = (current === 'en' ? en[key] : de[key]) ?? key;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) =>
    vars[k] !== undefined ? String(vars[k]) : `{${k}}`,
  );
}
