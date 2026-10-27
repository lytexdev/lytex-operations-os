import type { AppContext } from '../context';
import type { AnyEntity, EntityType } from '@/domain/schemas/entities';
import { DomainError } from '@/domain/errors/errors';
import { isBillingLocked } from '@/domain/policies/billing-status';
import { entityTitle } from '../queries/search';
import type { PlannedWrite } from '@/infrastructure/persistence/repository';
import { msg } from '@/shared/i18n';

export type DeletableType = Exclude<EntityType, 'billing_batch'>;

export interface DeletionImpact {
  /** Reasons that prevent deletion (e.g. billing data would lose its reference). */
  blockers: string[];
  /** Records deleted together with the target. */
  cascade: { id: string; type: EntityType; label: string }[];
  /** Records whose references are cleared. */
  unlink: { id: string; type: EntityType; label: string }[];
}

const NAMES = (): Record<EntityType, [string, string]> => ({
  customer: [msg('Kunde', 'customer'), msg('Kunden', 'customers')],
  contact: [msg('Ansprechpartner', 'contact'), msg('Ansprechpartner', 'contacts')],
  interaction: [msg('Kontakt', 'interaction'), msg('Kontakte', 'interactions')],
  project: [msg('Projekt', 'project'), msg('Projekte', 'projects')],
  ticket: ['Ticket', 'Tickets'],
  time_entry: [msg('Zeiteintrag', 'time entry'), msg('Zeiteinträge', 'time entries')],
  billing_batch: [
    msg('Abrechnungslauf', 'billing batch'),
    msg('Abrechnungsläufe', 'billing batches'),
  ],
  quote: [msg('Angebot', 'quote'), msg('Angebote', 'quotes')],
  expense: [msg('Ausgabe', 'expense'), msg('Ausgaben', 'expenses')],
  recurring_task: [
    msg('wiederkehrende Aufgabe', 'recurring task'),
    msg('wiederkehrende Aufgaben', 'recurring tasks'),
  ],
  service: [msg('Leistung', 'service'), msg('Leistungen', 'services')],
});

function count(n: number, type: EntityType): string {
  return `${n} ${NAMES()[type][n === 1 ? 0 : 1]}`;
}

function item(ctx: AppContext, e: AnyEntity) {
  return { id: e.id, type: e.type, label: entityTitle(ctx.index, e).title };
}

/**
 * What happens when an entity is deleted. Billing-relevant data (time entries, billing batches,
 * expenses, quotes on customers) are never deleted implicitly – they block the deletion instead,
 * so that invoices stay traceable. Archiving remains the alternative.
 */
export function deletionImpact(ctx: AppContext, type: DeletableType, id: string): DeletionImpact {
  const idx = ctx.index;
  const impact: DeletionImpact = { blockers: [], cascade: [], unlink: [] };
  const block = (list: AnyEntity[], what: EntityType, hint = '') => {
    if (list.length)
      impact.blockers.push(
        msg(
          `Es gibt noch ${count(list.length, what)}${hint}.`,
          `There are still ${count(list.length, what)}${hint}.`,
        ),
      );
  };
  const entries = idx.all('time_entry');
  switch (type) {
    case 'customer': {
      block(
        idx.all('project').filter((p) => p.customer_id === id),
        'project',
      );
      block(
        entries.filter((e) => e.customer_id === id),
        'time_entry',
      );
      block(
        idx.all('billing_batch').filter((b) => b.customer_id === id),
        'billing_batch',
      );
      block(
        idx.all('quote').filter((q) => q.customer_id === id),
        'quote',
      );
      block(
        idx.all('expense').filter((x) => x.customer_id === id),
        'expense',
      );
      for (const c of idx.all('contact'))
        if (c.customer_id === id) impact.cascade.push(item(ctx, c));
      for (const i of idx.all('interaction'))
        if (i.customer_id === id) impact.cascade.push(item(ctx, i));
      break;
    }
    case 'project': {
      block(
        entries.filter((e) => e.project_id === id),
        'time_entry',
        msg(
          ' (Zeiten sind Abrechnungsdaten – archivieren statt löschen)',
          ' (time is billing data – archive instead of deleting)',
        ),
      );
      block(
        idx.all('billing_batch').filter((b) => b.project_ids.includes(id)),
        'billing_batch',
      );
      block(
        idx.all('expense').filter((x) => x.project_id === id),
        'expense',
      );
      block(
        idx.all('recurring_task').filter((r) => r.project_id === id),
        'recurring_task',
      );
      for (const t of idx.all('ticket')) if (t.project_id === id) impact.cascade.push(item(ctx, t));
      for (const q of idx.all('quote')) if (q.project_id === id) impact.unlink.push(item(ctx, q));
      for (const i of idx.all('interaction'))
        if (i.project_id === id) impact.unlink.push(item(ctx, i));
      break;
    }
    case 'ticket': {
      block(
        entries.filter((e) => e.ticket_id === id),
        'time_entry',
        msg(
          ' auf diesem Ticket (archivieren statt löschen)',
          ' on this ticket (archive instead of deleting)',
        ),
      );
      block(
        idx.all('ticket').filter((t) => t.parent_id === id),
        'ticket',
        msg(' als Untertickets', ' as subtickets'),
      );
      for (const t of idx.all('ticket'))
        if (t.depends_on.includes(id)) impact.unlink.push(item(ctx, t));
      break;
    }
    case 'contact':
      for (const i of idx.all('interaction'))
        if (i.contact_ids.includes(id)) impact.unlink.push(item(ctx, i));
      break;
    case 'time_entry': {
      const e = ctx.repo.get('time_entry', id);
      if (isBillingLocked(e.billing_status))
        impact.blockers.push(
          msg(
            'Der Eintrag ist in Abrechnung oder abgerechnet.',
            'The entry is being billed or already invoiced.',
          ),
        );
      block(
        entries.filter((x) => x.adjusts_entry_id === id),
        'time_entry',
        msg(' als Korrekturbuchung', ' as an adjustment'),
      );
      break;
    }
    case 'expense': {
      const x = ctx.repo.get('expense', id);
      if (x.billing_status === 'reserved' || x.billing_status === 'invoiced')
        impact.blockers.push(
          msg(
            'Die Ausgabe ist in Abrechnung oder abgerechnet.',
            'The expense is being billed or already invoiced.',
          ),
        );
      break;
    }
    case 'recurring_task':
      for (const t of idx.all('ticket'))
        if (t.recurring_task_id === id) impact.unlink.push(item(ctx, t));
      break;
    case 'service': {
      const used = [
        ...idx.all('project').filter((p) => p.service_id === id),
        ...idx.all('ticket').filter((t) => t.service_id === id),
        ...entries.filter((e) => e.service_id === id),
        ...idx.all('recurring_task').filter((r) => r.service_id === id),
      ];
      if (used.length)
        impact.blockers.push(
          msg(
            `Die Leistung wird noch ${used.length}× verwendet.`,
            `The service is still used ${used.length}×.`,
          ),
        );
      break;
    }
    case 'quote':
    case 'interaction':
      break;
  }
  return impact;
}

/** Delete an entity (move to trash) after clearing references; cascaded records are trashed too. */
export async function deleteEntity(
  ctx: AppContext,
  type: DeletableType,
  id: string,
): Promise<void> {
  ctx.repo.get(type, id);
  const impact = deletionImpact(ctx, type, id);
  if (impact.blockers.length)
    throw new DomainError(
      'delete_blocked',
      msg(
        `Löschen nicht möglich: ${impact.blockers.join(' ')}`,
        `Cannot delete: ${impact.blockers.join(' ')}`,
      ),
      impact.blockers,
    );
  await ctx.repo.exclusive(async () => {
    const writes: PlannedWrite[] = [];
    for (const u of impact.unlink) {
      writes.push(
        await ctx.repo.planUpdate(u.type, u.id, (d: AnyEntity) => {
          if (d.type === 'ticket') {
            d.depends_on = d.depends_on.filter((x) => x !== id);
            if (d.recurring_task_id === id) d.recurring_task_id = null;
          }
          if (d.type === 'quote' && d.project_id === id) d.project_id = null;
          if (d.type === 'interaction') {
            if (d.project_id === id) d.project_id = null;
            d.contact_ids = d.contact_ids.filter((x) => x !== id);
          }
        }),
      );
    }
    if (writes.length) await ctx.repo.commit(`unlink before deleting ${id}`, writes);
  });
  // Cascade first, the target last: an interruption leaves at most an orphaned child, never a
  // child pointing to a missing parent that was deleted first.
  await ctx.repo.trash([...impact.cascade.map((c) => c.id), id]);
}
