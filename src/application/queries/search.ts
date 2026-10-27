import type { EntityIndex } from '@/infrastructure/indexing/entity-index';
import type { AnyEntity, EntityType } from '@/domain/schemas/entities';
import { normalize } from '@/shared/utilities/text';
import { msg } from '@/shared/i18n';

export interface SearchHit {
  id: string;
  type: EntityType;
  title: string;
  subtitle: string;
  score: number;
  archived: boolean;
}

export function entityTitle(index: EntityIndex, e: AnyEntity): { title: string; subtitle: string } {
  switch (e.type) {
    case 'customer':
      return { title: e.name, subtitle: `${e.customer_number} · ${e.email || e.website || ''}` };
    case 'contact':
      return {
        title: `${e.first_name} ${e.last_name}`.trim(),
        subtitle: index.get('customer', e.customer_id)?.name ?? '',
      };
    case 'interaction':
      return {
        title: e.subject,
        subtitle: `${e.occurred_at.slice(0, 10)} · ${index.get('customer', e.customer_id)?.name ?? ''}`,
      };
    case 'project':
      return {
        title: `${e.project_number} ${e.name}`,
        subtitle: index.get('customer', e.customer_id)?.name ?? msg('Intern', 'Internal'),
      };
    case 'ticket':
      return {
        title: `${e.ticket_number} ${e.title}`,
        subtitle: index.get('project', e.project_id)?.name ?? '',
      };
    case 'time_entry':
      return {
        title: e.description || msg('Zeiteintrag', 'Time entry'),
        subtitle: `${e.started_at.slice(0, 10)} · ${index.get('project', e.project_id)?.name ?? ''}`,
      };
    case 'billing_batch':
      return { title: e.batch_number, subtitle: index.get('customer', e.customer_id)?.name ?? '' };
    case 'quote':
      return {
        title: `${e.quote_number} ${e.title}`,
        subtitle: index.get('customer', e.customer_id)?.name ?? '',
      };
    case 'expense':
      return { title: e.description, subtitle: `${e.date} · ${e.vendor}` };
    case 'recurring_task':
      return { title: e.title, subtitle: index.get('project', e.project_id)?.name ?? '' };
    case 'service':
      return { title: e.name, subtitle: msg('Leistung', 'Service') };
  }
}

const SEARCH_TYPES: EntityType[] = [
  'customer',
  'contact',
  'project',
  'ticket',
  'quote',
  'billing_batch',
  'interaction',
  'expense',
  'recurring_task',
  'service',
];

/** Cross-entity search with simple token scoring. Time entries are excluded (use the timesheet). */
export function searchEntities(
  index: EntityIndex,
  query: string,
  limit = 50,
  includeArchived = false,
): SearchHit[] {
  const tokens = normalize(query).split(' ').filter(Boolean);
  if (!tokens.length) return [];
  const hits: SearchHit[] = [];
  for (const type of SEARCH_TYPES) {
    for (const e of index.all(type)) {
      if (e.archived && !includeArchived) continue;
      const { title, subtitle } = entityTitle(index, e);
      const hay = normalize(
        `${title} ${subtitle} ${e.tags.join(' ')} ${'email' in e ? e.email : ''} ${'category' in e ? e.category : ''}`,
      );
      const normTitle = normalize(title);
      let score = 0;
      let all = true;
      for (const tk of tokens) {
        if (!hay.includes(tk)) {
          all = false;
          break;
        }
        score += normTitle.startsWith(tk) ? 3 : normTitle.includes(tk) ? 2 : 1;
      }
      if (!all) continue;
      if (type === 'customer' || type === 'project') score += 1;
      hits.push({ id: e.id, type, title, subtitle, score, archived: e.archived });
    }
  }
  return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
}
