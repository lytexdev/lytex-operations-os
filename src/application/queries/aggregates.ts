import type { EntityIndex } from '@/infrastructure/indexing/entity-index';
import type { Expense, Project, TimeEntry } from '@/domain/schemas/entities';
import { amountForSeconds } from '@/shared/money/money';
import {
  addDays,
  localDate,
  parseIso,
  startOfMonth,
  startOfWeek,
  type IsoDate,
} from '@/shared/date/time';
import type { ProjectTimeTotals } from '@/domain/services/budget';

/**
 * Metric definitions (see DATA_MODEL.md, "Kennzahlen"):
 *  - tracked:   all non-archived time entries (incl. non-billable), excluding written-off adjustments
 *  - billable:  tracked entries with billable = true and status ≠ written_off
 *  - approved:  billable entries with status approved/reserved
 *  - unbilled value: billable entries with status unbilled/approved (rate snapshot × duration)
 *  - invoiced:  billing batches with status invoiced (net amount)
 *  - paid:      only batches with explicit paid_cents/paid_at
 *  - projected: unbilled value + reserved (not yet invoiced) batch amounts
 */

function memo<T>(index: EntityIndex, key: string, compute: () => T): T {
  const store = (memo.cache.get(index) ?? new Map<string, { v: number; value: unknown }>()) as Map<
    string,
    { v: number; value: unknown }
  >;
  memo.cache.set(index, store);
  const hit = store.get(key);
  if (hit && hit.v === index.version) return hit.value as T;
  const value = compute();
  store.set(key, { v: index.version, value });
  return value;
}
memo.cache = new WeakMap<EntityIndex, Map<string, { v: number; value: unknown }>>();

export function activeEntries(index: EntityIndex): TimeEntry[] {
  return memo(index, 'activeEntries', () => index.all('time_entry').filter((e) => !e.archived));
}

export function entryValueCents(e: TimeEntry): number {
  if (!e.billable) return 0;
  return (
    amountForSeconds(Math.abs(e.duration_seconds), e.rate_cents) * Math.sign(e.duration_seconds)
  );
}

export function trackedSecondsByTicket(index: EntityIndex): Map<string, number> {
  return memo(index, 'byTicket', () => {
    const m = new Map<string, number>();
    for (const e of activeEntries(index))
      if (e.ticket_id) m.set(e.ticket_id, (m.get(e.ticket_id) ?? 0) + e.duration_seconds);
    return m;
  });
}

export function entriesByProject(index: EntityIndex): Map<string, TimeEntry[]> {
  return memo(index, 'entriesByProject', () => {
    const m = new Map<string, TimeEntry[]>();
    for (const e of activeEntries(index)) {
      const l = m.get(e.project_id) ?? [];
      l.push(e);
      m.set(e.project_id, l);
    }
    return m;
  });
}

export function projectTotals(index: EntityIndex, projectId: string): ProjectTimeTotals {
  return memo(index, `totals:${projectId}`, () => {
    const t: ProjectTimeTotals = {
      trackedSeconds: 0,
      billableSeconds: 0,
      nonBillableSeconds: 0,
      billableValueCents: 0,
      invoicedValueCents: 0,
      expensesCents: 0,
    };
    for (const e of entriesByProject(index).get(projectId) ?? []) {
      if (e.billing_status === 'written_off') {
        t.trackedSeconds += e.duration_seconds;
        t.nonBillableSeconds += e.duration_seconds;
        continue;
      }
      t.trackedSeconds += e.duration_seconds;
      if (e.billable) {
        t.billableSeconds += e.duration_seconds;
        const v = entryValueCents(e);
        t.billableValueCents += v;
        if (e.billing_status === 'invoiced' || e.billing_status === 'adjusted')
          t.invoicedValueCents += v;
      } else t.nonBillableSeconds += e.duration_seconds;
    }
    for (const x of index.all('expense'))
      if (x.project_id === projectId && !x.archived) t.expensesCents += x.amount_cents;
    return t;
  });
}

export interface PeriodTotals {
  trackedSeconds: number;
  billableSeconds: number;
  nonBillableSeconds: number;
  billableValueCents: number;
}

export function totalsBetween(
  index: EntityIndex,
  from: IsoDate,
  toExclusive: IsoDate,
): PeriodTotals {
  return memo(index, `period:${from}:${toExclusive}`, () => {
    const t: PeriodTotals = {
      trackedSeconds: 0,
      billableSeconds: 0,
      nonBillableSeconds: 0,
      billableValueCents: 0,
    };
    for (const e of activeEntries(index)) {
      if (e.source === 'adjustment') continue;
      const d = localDate(parseIso(e.started_at));
      if (d < from || d >= toExclusive) continue;
      t.trackedSeconds += e.duration_seconds;
      if (e.billable && e.billing_status !== 'written_off') {
        t.billableSeconds += e.duration_seconds;
        t.billableValueCents += entryValueCents(e);
      } else t.nonBillableSeconds += e.duration_seconds;
    }
    return t;
  });
}

export function periodRanges(today: IsoDate) {
  const week = startOfWeek(today);
  const month = startOfMonth(today);
  const [y, m] = today.split('-').map(Number) as [number, number];
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return {
    today: [today, addDays(today, 1)] as const,
    week: [week, addDays(week, 7)] as const,
    month: [month, nextMonth] as const,
  };
}

export interface FinanceSummary {
  unbilledValueCents: number;
  approvedValueCents: number;
  reservedValueCents: number;
  invoicedCents: number;
  paidCents: number;
  openInvoicedCents: number;
  unbilledExpensesCents: number;
}

export function financeSummary(index: EntityIndex): FinanceSummary {
  return memo(index, 'finance', () => {
    const s: FinanceSummary = {
      unbilledValueCents: 0,
      approvedValueCents: 0,
      reservedValueCents: 0,
      invoicedCents: 0,
      paidCents: 0,
      openInvoicedCents: 0,
      unbilledExpensesCents: 0,
    };
    for (const e of activeEntries(index)) {
      if (!e.billable) continue;
      const v = entryValueCents(e);
      if (e.billing_status === 'unbilled') s.unbilledValueCents += v;
      else if (e.billing_status === 'approved') {
        s.unbilledValueCents += v;
        s.approvedValueCents += v;
      } else if (e.billing_status === 'reserved') s.reservedValueCents += v;
    }
    for (const b of index.all('billing_batch')) {
      if (b.status === 'invoiced') {
        s.invoicedCents += b.net_cents;
        if (b.paid_cents != null) s.paidCents += b.paid_cents;
        else s.openInvoicedCents += b.net_cents;
      }
    }
    for (const x of index.all('expense'))
      if (!x.archived && (x.billing_status === 'unbilled' || x.billing_status === 'approved'))
        s.unbilledExpensesCents += x.amount_cents;
    return s;
  });
}

export function sumBy<T>(
  items: T[],
  key: (t: T) => string | null,
  value: (t: T) => number,
): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) {
    const k = key(it) ?? '—';
    m.set(k, (m.get(k) ?? 0) + value(it));
  }
  return m;
}

export function dailySeries(
  index: EntityIndex,
  from: IsoDate,
  days: number,
): { date: IsoDate; tracked: number; billable: number }[] {
  const out: { date: IsoDate; tracked: number; billable: number }[] = [];
  const pos = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const d = addDays(from, i);
    pos.set(d, i);
    out.push({ date: d, tracked: 0, billable: 0 });
  }
  for (const e of activeEntries(index)) {
    if (e.source === 'adjustment') continue;
    const i = pos.get(localDate(parseIso(e.started_at)));
    if (i === undefined) continue;
    out[i]!.tracked += e.duration_seconds;
    if (e.billable && e.billing_status !== 'written_off') out[i]!.billable += e.duration_seconds;
  }
  return out;
}

export function projectExpenses(index: EntityIndex, projectId: string): Expense[] {
  return index.all('expense').filter((x) => x.project_id === projectId && !x.archived);
}

export function customerProjects(index: EntityIndex, customerId: string): Project[] {
  return index.all('project').filter((p) => p.customer_id === customerId);
}
