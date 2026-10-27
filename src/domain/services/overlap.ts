import type { TimeEntry } from '../schemas/entities';
import { overlaps, parseIso } from '@/shared/date/time';

export interface Interval {
  start: number;
  end: number;
}

export function entryIntervals(
  e: Pick<TimeEntry, 'segments' | 'started_at' | 'ended_at'>,
): Interval[] {
  if (e.segments.length)
    return e.segments.map((s) => ({ start: parseIso(s.start), end: parseIso(s.end) }));
  return [{ start: parseIso(e.started_at), end: parseIso(e.ended_at) }];
}

/** Return existing entries that overlap with the candidate (excluding itself and adjustments). */
export function findOverlaps(
  candidate: Interval[],
  existing: TimeEntry[],
  ignoreId?: string,
): TimeEntry[] {
  return existing.filter((e) => {
    if (
      e.id === ignoreId ||
      e.source === 'adjustment' ||
      e.archived ||
      e.billing_status === 'written_off'
    )
      return false;
    const iv = entryIntervals(e);
    return candidate.some((c) => iv.some((x) => overlaps(c.start, c.end, x.start, x.end)));
  });
}
