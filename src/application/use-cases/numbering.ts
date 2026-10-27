import type { EntityIndex } from '@/infrastructure/indexing/entity-index';

function maxNumber(values: string[], re: RegExp): number {
  let max = 0;
  for (const v of values) {
    const m = re.exec(v);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

/** Human-readable numbers are derived from existing data (no separate counter that could drift). */
export function nextCustomerNumber(index: EntityIndex): string {
  return `K-${String(
    maxNumber(
      index.all('customer').map((c) => c.customer_number),
      /^K-(\d+)$/,
    ) + 1,
  ).padStart(4, '0')}`;
}

export function nextProjectNumber(index: EntityIndex): string {
  return `P-${String(
    maxNumber(
      index.all('project').map((p) => p.project_number),
      /^P-(\d+)$/,
    ) + 1,
  ).padStart(4, '0')}`;
}

export function nextTicketNumber(index: EntityIndex, projectId: string, key: string): string {
  const re = new RegExp(`^${key}-(\\d+)$`);
  const nums = index
    .all('ticket')
    .filter((t) => t.project_id === projectId)
    .map((t) => t.ticket_number);
  return `${key}-${maxNumber(nums, re) + 1}`;
}

export function nextYearlyNumber(values: string[], prefix: string, year: number): string {
  const re = new RegExp(`^${prefix}-${year}-(\\d+)$`);
  return `${prefix}-${year}-${String(maxNumber(values, re) + 1).padStart(3, '0')}`;
}

export function suggestProjectKey(name: string, taken: Set<string>): string {
  const letters = name
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9 ]/g, '')
    .toUpperCase()
    .split(/\s+/)
    .filter(Boolean);
  let base =
    letters.length > 1
      ? letters
          .map((w) => w[0])
          .join('')
          .slice(0, 4)
      : (letters[0] ?? 'PRJ').slice(0, 4);
  if (!/^[A-Z]/.test(base)) base = `P${base}`;
  if (base.length < 2) base = `${base}X`;
  let key = base;
  for (let i = 2; taken.has(key); i++) key = `${base}${i}`;
  return key;
}
