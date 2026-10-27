import type { EntityIndex } from '@/infrastructure/indexing/entity-index';
import type { Ticket } from '@/domain/schemas/entities';
import { isClosed, type WorkflowStatus } from '@/domain/policies/workflow';
import { addDays, type IsoDate } from '@/shared/date/time';
import { normalize } from '@/shared/utilities/text';

export type TicketPreset = 'all' | 'mine' | 'dueSoon' | 'overdue' | 'completed' | 'everything';

export interface TicketFilter {
  preset: TicketPreset;
  projectId?: string | null;
  customerId?: string | null;
  priority?: string | null;
  category?: string | null;
  text?: string;
  includeArchived?: boolean;
}

const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };

export function filterTickets(
  index: EntityIndex,
  workflow: WorkflowStatus[],
  f: TicketFilter,
  today: IsoDate,
  me: string,
  dueSoonDays: number,
): Ticket[] {
  const text = f.text ? normalize(f.text) : '';
  const soon = addDays(today, dueSoonDays);
  return index
    .all('ticket')
    .filter((t) => {
      if (t.archived && !f.includeArchived) return false;
      if (f.projectId && t.project_id !== f.projectId) return false;
      if (f.customerId && t.customer_id !== f.customerId) return false;
      if (f.priority && t.priority !== f.priority) return false;
      if (f.category && t.category !== f.category) return false;
      const closed = isClosed(workflow, t.status);
      switch (f.preset) {
        case 'all':
          if (closed) return false;
          break;
        case 'mine':
          // "Meine Arbeit": every open ticket assigned to me.
          if (closed || !t.assignees.includes(me)) return false;
          break;
        case 'dueSoon':
          if (closed || !t.due_date || t.due_date < today || t.due_date > soon) return false;
          break;
        case 'overdue':
          if (closed || !t.due_date || t.due_date >= today) return false;
          break;
        case 'completed':
          if (!closed) return false;
          break;
        case 'everything':
          break;
      }
      if (
        text &&
        !normalize(`${t.ticket_number} ${t.title} ${t.category} ${t.tags.join(' ')}`).includes(text)
      )
        return false;
      return true;
    })
    .sort(compareTickets);
}

export function compareTickets(a: Ticket, b: Ticket): number {
  return (
    a.sort_order - b.sort_order ||
    (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) ||
    (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') ||
    a.ticket_number.localeCompare(b.ticket_number, undefined, { numeric: true })
  );
}

export function isOverdue(t: Ticket, workflow: WorkflowStatus[], today: IsoDate): boolean {
  return !!t.due_date && t.due_date < today && !isClosed(workflow, t.status);
}
