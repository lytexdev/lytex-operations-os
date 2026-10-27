import { z } from 'zod';
import { isIsoDate, isIsoInstant } from '@/shared/date/time';
import { msg } from '@/shared/i18n';

/** Accept Date objects (some YAML parsers produce them) and normalize to ISO strings. */
export const zInstant = z.preprocess(
  (v) => (v instanceof Date ? v.toISOString().replace(/\.\d{3}Z$/, 'Z') : v),
  z.string().refine(isIsoInstant, {
    error: () =>
      msg('Ungültiger Zeitstempel (ISO-8601 erwartet)', 'Invalid timestamp (ISO 8601 expected)'),
  }),
);

export const zDate = z.preprocess(
  (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v),
  z.string().refine(isIsoDate, {
    error: () =>
      msg('Ungültiges Datum (YYYY-MM-DD erwartet)', 'Invalid date (YYYY-MM-DD expected)'),
  }),
);

export const zOptDate = z.preprocess((v) => (v === '' ? null : v), zDate.nullable()).default(null);
export const zOptInstant = z
  .preprocess((v) => (v === '' ? null : v), zInstant.nullable())
  .default(null);

export const zCents = z.number().int({
  error: () => msg('Betrag muss in ganzen Cent angegeben sein', 'Amount must be whole cents'),
});
export const zOptCents = zCents.nullable().default(null);
export const zSeconds = z.number().int().nonnegative();
export const zOptSeconds = zSeconds.nullable().default(null);

export const zStr = z.preprocess(
  (v) => (v === null || v === undefined ? '' : typeof v === 'number' ? String(v) : v),
  z.string(),
);
export const zRef = z.string().regex(/^[A-Z]{2,4}-[A-Z0-9-]{3,40}$/, {
  error: () => msg('Ungültige ID-Referenz', 'Invalid ID reference'),
});
export const zOptRef = z.preprocess((v) => (v === '' ? null : v), zRef.nullable()).default(null);
export const zRefs = z.array(zRef).default([]);
export const zTags = z.preprocess(
  (v) =>
    typeof v === 'string'
      ? v
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : (v ?? []),
  z.array(z.string()),
);

export const CURRENCIES = ['EUR', 'CHF', 'USD', 'GBP'] as const;
export const zCurrency = z.enum(CURRENCIES).default('EUR');

export const PRIORITIES = ['low', 'normal', 'high', 'critical'] as const;
export const zPriority = z.enum(PRIORITIES).default('normal');
export type Priority = (typeof PRIORITIES)[number];

export const baseFields = {
  schema_version: z.number().int().positive(),
  id: zRef,
  created_at: zInstant,
  updated_at: zInstant,
  archived: z.boolean().default(false),
  tags: zTags.default([]),
};

export const zAddress = z
  .object({
    street: zStr.default(''),
    zip: zStr.default(''),
    city: zStr.default(''),
    country: zStr.default(''),
  })
  .default({ street: '', zip: '', city: '', country: '' });
export type Address = z.infer<typeof zAddress>;

export const zHistoryItem = z.object({
  at: zInstant,
  action: z.string(),
  detail: zStr.default(''),
});
export type HistoryItem = z.infer<typeof zHistoryItem>;
