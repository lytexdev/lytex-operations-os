import { ulid, isUlid } from './ulid';

/** Entity ID prefixes. IDs look like `CUS-01JD3…` and are immutable once written. */
export const ID_PREFIX = {
  customer: 'CUS',
  contact: 'CON',
  interaction: 'INT',
  project: 'PRJ',
  ticket: 'TKT',
  time_entry: 'TIM',
  time_adjustment: 'ADJ',
  billing_batch: 'BAT',
  quote: 'QUO',
  expense: 'EXP',
  recurring_task: 'REC',
  service: 'SRV',
  timer_session: 'SES',
  operation: 'OP',
} as const;

export type IdKind = keyof typeof ID_PREFIX;

export function newId(kind: IdKind): string {
  return `${ID_PREFIX[kind]}-${ulid()}`;
}

export function isEntityId(value: unknown, kind?: IdKind): value is string {
  if (typeof value !== 'string') return false;
  const m = /^([A-Z]{2,4})-(.+)$/.exec(value);
  if (!m) return false;
  if (kind && m[1] !== ID_PREFIX[kind]) return false;
  return isUlid(m[2]!) || /^[A-Z0-9-]{3,40}$/.test(m[2]!);
}

/** Derive a deterministic child ID from a parent ID, e.g. the time entry for a timer session. */
export function derivedId(kind: IdKind, parentId: string): string {
  const suffix = parentId.replace(/^[A-Z]{2,4}-/, '');
  return `${ID_PREFIX[kind]}-${suffix}`;
}
