import type { Recurrence, RecurringTask } from '../schemas/entities';
import { addDays, addMonths, daysBetween, type IsoDate } from '@/shared/date/time';
import { msg } from '@/shared/i18n';

/** ISO weekday of a local date: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: IsoDate): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const dow = new Date(y, m - 1, d, 12).getDay();
  return dow === 0 ? 7 : dow;
}

/**
 * All occurrence dates of a recurrence within [from, to] (inclusive), anchored at `start`.
 * Pure and deterministic: the same inputs always produce the same dates, which together with
 * the occurrence key `<taskId>@<date>` makes ticket generation idempotent.
 */
export function occurrencesBetween(
  rec: Recurrence,
  start: IsoDate,
  from: IsoDate,
  to: IsoDate,
  end: IsoDate | null = null,
): IsoDate[] {
  const out: IsoDate[] = [];
  const upper = end && end < to ? end : to;
  if (upper < start || upper < from) return out;
  const lower = from > start ? from : start;
  const guard = 5000;
  switch (rec.freq) {
    case 'daily':
    case 'interval_days': {
      const step = rec.interval;
      const offset = daysBetween(start, lower);
      let k = Math.max(0, Math.ceil(offset / step));
      for (let i = 0; i < guard; i++, k++) {
        const d = addDays(start, k * step);
        if (d > upper) break;
        if (d >= lower) out.push(d);
      }
      break;
    }
    case 'weekly': {
      const weekdays = rec.weekdays.length ? [...rec.weekdays].sort() : [isoWeekday(start)];
      const startMonday = addDays(start, -(isoWeekday(start) - 1));
      const offsetWeeks = Math.max(0, Math.floor(daysBetween(startMonday, lower) / 7));
      let week = offsetWeeks - (offsetWeeks % rec.interval);
      for (let i = 0; i < guard; i++, week += rec.interval) {
        const monday = addDays(startMonday, week * 7);
        if (monday > upper) break;
        for (const wd of weekdays) {
          const d = addDays(monday, wd - 1);
          if (d >= lower && d <= upper && d >= start) out.push(d);
        }
      }
      break;
    }
    case 'monthly': {
      const day = rec.day_of_month ?? Number(start.slice(8, 10));
      const startMonth = `${start.slice(0, 7)}-01`;
      for (let k = 0; k < guard; k += rec.interval) {
        const d = addMonths(startMonth, k, day);
        if (d > upper) break;
        if (d >= lower && d >= start) out.push(d);
      }
      break;
    }
  }
  return out;
}

export function occurrenceKey(taskId: string, date: IsoDate): string {
  return `${taskId}@${date}`;
}

export interface PlannedOccurrence {
  key: string;
  date: IsoDate;
}

/**
 * Determine which occurrences need a ticket. Includes missed occurrences since the last
 * reconciliation (Obsidian may have been closed) and those due within the lead window.
 * `existingKeys` must contain the occurrence keys of all tickets already generated, so that
 * re-running is safe even if `generated_through` was not persisted after a crash.
 */
export function planOccurrences(
  task: RecurringTask,
  today: IsoDate,
  existingKeys: ReadonlySet<string>,
): PlannedOccurrence[] {
  if (!task.active || task.archived) return [];
  const horizon = addDays(today, task.lead_days);
  const from = task.generated_through ? addDays(task.generated_through, 1) : task.start_date;
  return occurrencesBetween(task.recurrence, task.start_date, from, horizon, task.end_date)
    .map((date) => ({ date, key: occurrenceKey(task.id, date) }))
    .filter((o) => !existingKeys.has(o.key));
}

export function nextOccurrence(task: RecurringTask, today: IsoDate): IsoDate | null {
  const list = occurrencesBetween(
    task.recurrence,
    task.start_date,
    today,
    addDays(today, 800),
    task.end_date,
  );
  return list[0] ?? null;
}

export function describeRecurrence(rec: Recurrence): string {
  const wd = ['', ...msg('Mo Di Mi Do Fr Sa So', 'Mon Tue Wed Thu Fri Sat Sun').split(' ')];
  switch (rec.freq) {
    case 'daily':
      return rec.interval === 1
        ? msg('Täglich', 'Daily')
        : msg(`Alle ${rec.interval} Tage`, `Every ${rec.interval} days`);
    case 'interval_days':
      return msg(`Alle ${rec.interval} Tage`, `Every ${rec.interval} days`);
    case 'weekly': {
      const days = rec.weekdays.length ? ` (${rec.weekdays.map((d) => wd[d]).join(', ')})` : '';
      return (
        (rec.interval === 1
          ? msg('Wöchentlich', 'Weekly')
          : msg(`Alle ${rec.interval} Wochen`, `Every ${rec.interval} weeks`)) + days
      );
    }
    case 'monthly':
      return (
        (rec.interval === 1
          ? msg('Monatlich', 'Monthly')
          : msg(`Alle ${rec.interval} Monate`, `Every ${rec.interval} months`)) +
        (rec.day_of_month ? msg(` am ${rec.day_of_month}.`, ` on day ${rec.day_of_month}`) : '')
      );
  }
}
