import type { EntityIndex } from '@/infrastructure/indexing/entity-index';
import type { EntityType } from '@/domain/schemas/entities';
import { msg } from '@/shared/i18n';

export interface TimelineItem {
  at: string;
  type: EntityType;
  id: string;
  text: string;
}

/** Activity timeline for a customer (projects, tickets, interactions, batches, quotes). */
export function customerTimeline(
  index: EntityIndex,
  customerId: string,
  limit = 50,
): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const i of index.all('interaction'))
    if (i.customer_id === customerId)
      items.push({
        at: i.occurred_at,
        type: 'interaction',
        id: i.id,
        text: `${i.kind}: ${i.subject}`,
      });
  for (const p of index.all('project'))
    if (p.customer_id === customerId)
      items.push({
        at: p.created_at,
        type: 'project',
        id: p.id,
        text: msg(`Projekt angelegt: ${p.name}`, `Project created: ${p.name}`),
      });
  for (const t of index.all('ticket')) {
    if (t.customer_id !== customerId) continue;
    items.push({
      at: t.created_at,
      type: 'ticket',
      id: t.id,
      text: `Ticket ${t.ticket_number}: ${t.title}`,
    });
    if (t.completed_at)
      items.push({
        at: t.completed_at,
        type: 'ticket',
        id: t.id,
        text: msg(`Ticket ${t.ticket_number} abgeschlossen`, `Ticket ${t.ticket_number} completed`),
      });
  }
  for (const b of index.all('billing_batch'))
    if (b.customer_id === customerId)
      items.push({
        at: b.invoiced_at ?? b.created_at,
        type: 'billing_batch',
        id: b.id,
        text: msg(
          `Abrechnung ${b.batch_number} (${b.status})`,
          `Billing ${b.batch_number} (${b.status})`,
        ),
      });
  for (const q of index.all('quote'))
    if (q.customer_id === customerId)
      items.push({
        at: q.updated_at,
        type: 'quote',
        id: q.id,
        text: msg(
          `Angebot ${q.quote_number}: ${q.title} (${q.status})`,
          `Quote ${q.quote_number}: ${q.title} (${q.status})`,
        ),
      });
  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

/** Global recent activity across all entities (by updated_at). */
export function recentActivity(
  index: EntityIndex,
  limit = 12,
): { id: string; type: EntityType; at: string }[] {
  const all: { id: string; type: EntityType; at: string }[] = [];
  for (const type of [
    'customer',
    'project',
    'ticket',
    'time_entry',
    'billing_batch',
    'quote',
    'expense',
    'interaction',
  ] as EntityType[]) {
    for (const e of index.all(type)) all.push({ id: e.id, type, at: e.updated_at });
  }
  return all.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
