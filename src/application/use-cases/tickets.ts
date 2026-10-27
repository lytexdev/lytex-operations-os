import type { AppContext } from '../context';
import type { Ticket } from '@/domain/schemas/entities';
import type { CreateInput } from '@/infrastructure/persistence/repository';
import { DomainError, ValidationError } from '@/domain/errors/errors';
import {
  checkDefinitionOfDone,
  categoryOf,
  isClosed,
  statusOf,
  wouldCreateCycle,
} from '@/domain/policies/workflow';
import { nextTicketNumber } from './numbering';
import { toIso } from '@/shared/date/time';
import { ulid } from '@/shared/ids/ulid';
import { trackedSecondsByTicket } from '../queries/aggregates';
import { compareTickets } from '../queries/tickets';
import { msg } from '@/shared/i18n';

export type TicketInput = Omit<
  CreateInput<'ticket'>,
  'ticket_number' | 'customer_id' | 'activity' | 'completed_at'
> & { customer_id?: string | null };

export async function createTicket(
  ctx: AppContext,
  input: TicketInput,
  description = '',
): Promise<Ticket> {
  return ctx.repo.exclusive(async () => {
    const w = await planTicket(ctx, input, description);
    await ctx.repo.commit('create ticket', [w]);
    return w.entity as Ticket;
  });
}

export async function planTicket(
  ctx: AppContext,
  input: TicketInput,
  description = '',
  reserved?: Set<string>,
  numberOffset = 0,
) {
  const project = ctx.repo.get('project', input.project_id);
  const s = ctx.settings();
  if (!statusOf(s.workflow, input.status))
    throw new ValidationError(
      msg(`Unbekannter Status: ${input.status}`, `Unknown status: ${input.status}`),
    );
  if (input.parent_id) {
    const parent = ctx.repo.get('ticket', input.parent_id);
    if (parent.project_id !== project.id)
      throw new ValidationError(
        msg(
          'Übergeordnetes Ticket muss im selben Projekt liegen',
          'Parent ticket must be in the same project',
        ),
      );
  }
  for (const d of input.depends_on) ctx.repo.get('ticket', d);
  let number = nextTicketNumber(ctx.index, project.id, project.key);
  if (numberOffset) number = `${project.key}-${Number(number.split('-').pop()) + numberOffset}`;
  const now = toIso(ctx.clock.now());
  return ctx.repo.planCreate(
    'ticket',
    {
      ...input,
      billable: project.billing_model === 'internal' ? false : input.billable,
      ticket_number: number,
      customer_id: project.customer_id,
      // New tickets are appended at the end of their status column (manual ordering).
      sort_order: input.sort_order || nextSortOrder(ctx, input.status) + numberOffset * 10,
      completed_at: isClosed(s.workflow, input.status) ? now : null,
      activity: [{ at: now, action: 'created', detail: '' }],
    },
    { description },
    reserved,
  );
}

export async function updateTicket(
  ctx: AppContext,
  id: string,
  patch: Partial<Ticket>,
  expectedUpdatedAt?: string,
): Promise<Ticket> {
  const cur = ctx.repo.get('ticket', id);
  if (patch.status && patch.status !== cur.status) {
    await changeTicketStatus(ctx, id, patch.status);
  }
  const { status: _s, ...rest } = patch;
  if (rest.project_id && rest.project_id !== cur.project_id) {
    throw new ValidationError(
      msg(
        'Tickets können nicht in ein anderes Projekt verschoben werden (Ticketnummer ist projektgebunden).',
        'Tickets cannot be moved to another project (the ticket number belongs to the project).',
      ),
    );
  }
  if (rest.depends_on) {
    const deps = depMap(ctx);
    for (const d of rest.depends_on)
      if (!cur.depends_on.includes(d) && wouldCreateCycle(deps, id, d))
        throw new ValidationError(msg('Zirkuläre Abhängigkeit', 'Circular dependency'));
  }
  if (rest.parent_id && rest.parent_id === id)
    throw new ValidationError(
      msg(
        'Ticket kann nicht sein eigenes Unterticket sein',
        'A ticket cannot be its own subticket',
      ),
    );
  return ctx.repo.update(
    'ticket',
    id,
    (d) => {
      const changed = Object.keys(rest).filter(
        (k) =>
          JSON.stringify((d as Record<string, unknown>)[k]) !==
            JSON.stringify((rest as Record<string, unknown>)[k]) && k !== 'activity',
      );
      const next = {
        ...d,
        ...rest,
        id: d.id,
        type: d.type,
        created_at: d.created_at,
        status: d.status,
      };
      if (changed.length)
        next.activity = [
          ...d.activity,
          { at: toIso(ctx.clock.now()), action: 'updated', detail: changed.join(', ') },
        ];
      return next;
    },
    { expectedUpdatedAt },
  );
}

function depMap(ctx: AppContext): Map<string, string[]> {
  return new Map(ctx.index.all('ticket').map((t) => [t.id, t.depends_on]));
}

export function doneProblems(ctx: AppContext, ticket: Ticket): string[] {
  const s = ctx.settings();
  return checkDefinitionOfDone(ticket, {
    workflow: s.workflow,
    rules: s.doneRules,
    dependencies: ticket.depends_on
      .map((d) => ctx.index.get('ticket', d))
      .filter((x): x is Ticket => !!x),
    trackedSeconds: trackedSecondsByTicket(ctx.index).get(ticket.id) ?? 0,
  });
}

export async function changeTicketStatus(
  ctx: AppContext,
  id: string,
  status: string,
  opts: { force?: boolean } = {},
): Promise<Ticket> {
  const s = ctx.settings();
  const target = statusOf(s.workflow, status);
  if (!target)
    throw new ValidationError(msg(`Unbekannter Status: ${status}`, `Unknown status: ${status}`));
  const ticket = ctx.repo.get('ticket', id);
  if (ticket.status === status) return ticket;
  if (target.category === 'done' && !opts.force) {
    const problems = doneProblems(ctx, ticket);
    if (problems.length)
      throw new DomainError(
        'dod_failed',
        msg('Definition of Done nicht erfüllt', 'Definition of Done not met') +
          `:\n${problems.join('\n')}`,
        problems,
      );
  }
  return ctx.repo.update('ticket', id, (d) => {
    const now = toIso(ctx.clock.now());
    const from = d.status;
    d.status = status;
    const closed = target.category === 'done' || target.category === 'cancelled';
    d.completed_at = closed ? (d.completed_at ?? now) : null;
    d.activity.push({
      at: now,
      action: 'status',
      detail: `${from} → ${status}${opts.force ? msg(' (DoD übersprungen)', ' (DoD skipped)') : ''}`,
    });
  });
}

export function nextSortOrder(ctx: AppContext, status: string): number {
  let max = 0;
  for (const t of ctx.index.all('ticket'))
    if (t.status === status && !t.archived) max = Math.max(max, t.sort_order);
  return max + 10;
}

/**
 * Drag & drop: put ticket `id` into column `status` directly before `beforeId` (or at the end).
 * The status change runs first (Definition of Done may reject it); then the column is renumbered
 * (10, 20, …) in one journaled operation, writing only tickets whose position changed.
 */
export async function placeTicket(
  ctx: AppContext,
  id: string,
  status: string,
  beforeId: string | null,
): Promise<void> {
  const ticket = ctx.repo.get('ticket', id);
  if (ticket.status !== status) await changeTicketStatus(ctx, id, status);
  await ctx.repo.exclusive(async () => {
    const column = ctx.index
      .all('ticket')
      .filter((t) => t.status === status && !t.archived && t.id !== id)
      .sort(compareTickets);
    const idx = beforeId ? column.findIndex((t) => t.id === beforeId) : -1;
    const moved = ctx.repo.get('ticket', id);
    column.splice(idx < 0 ? column.length : idx, 0, moved);
    const writes = [];
    for (const [i, t] of column.entries()) {
      const order = (i + 1) * 10;
      if (t.sort_order !== order) {
        writes.push(
          await ctx.repo.planUpdate('ticket', t.id, (d) => {
            d.sort_order = order;
          }),
        );
      }
    }
    if (writes.length) await ctx.repo.commit(`reorder ${status}`, writes);
  });
}

/** Markdown body (description, notes) of an entity note, read fresh from the file. */
export async function readTicketBody(ctx: AppContext, id: string): Promise<string> {
  return ctx.repo.readBody('ticket', id);
}

export async function updateTicketBody(
  ctx: AppContext,
  id: string,
  body: string,
  expectedUpdatedAt?: string,
): Promise<Ticket> {
  return ctx.repo.updateBody('ticket', id, body, {
    expectedUpdatedAt,
    label: 'update ticket body',
  });
}

/**
 * One-time migration: the placeholder assignee "LYTEX" (default up to settings v1) becomes the
 * plugin owner. Also writes tickets that were only migrated in memory (schema v1 → v2).
 */
export async function migrateLegacyAssignees(ctx: AppContext, me: string): Promise<number> {
  let n = 0;
  for (const t of ctx.index.all('ticket')) {
    // Without a known owner the placeholder stays; only the schema write-back happens.
    const legacy = !!me && t.assignees.includes('LYTEX');
    const inMemoryOnly = ctx.index.record(t.id)?.migrated ?? false;
    if (!legacy && !inMemoryOnly) continue;
    await ctx.repo.update('ticket', t.id, (d) => {
      if (legacy) d.assignees = [...new Set(d.assignees.map((a) => (a === 'LYTEX' ? me : a)))];
    });
    n++;
  }
  return n;
}

export async function moveTicket(
  ctx: AppContext,
  id: string,
  status: string,
  sortOrder: number,
): Promise<Ticket> {
  const t = ctx.repo.get('ticket', id);
  if (t.status !== status) await changeTicketStatus(ctx, id, status);
  return ctx.repo.update('ticket', id, (d) => {
    d.sort_order = sortOrder;
  });
}

export async function addComment(ctx: AppContext, id: string, text: string): Promise<Ticket> {
  if (!text.trim()) throw new ValidationError(msg('Kommentar ist leer', 'Comment is empty'));
  return ctx.repo.update('ticket', id, (d) => {
    d.activity.push({ at: toIso(ctx.clock.now()), action: 'comment', detail: text.trim() });
  });
}

export async function addChecklistItem(
  ctx: AppContext,
  id: string,
  text: string,
  required = false,
): Promise<Ticket> {
  if (!text.trim()) throw new ValidationError(msg('Text ist erforderlich', 'Text is required'));
  return ctx.repo.update('ticket', id, (d) => {
    d.checklist.push({ id: ulid(), text: text.trim(), done: false, required });
  });
}

export async function toggleChecklistItem(
  ctx: AppContext,
  id: string,
  itemId: string,
): Promise<Ticket> {
  return ctx.repo.update('ticket', id, (d) => {
    const item = d.checklist.find((c) => c.id === itemId);
    if (item) item.done = !item.done;
  });
}

export async function removeChecklistItem(
  ctx: AppContext,
  id: string,
  itemId: string,
): Promise<Ticket> {
  return ctx.repo.update('ticket', id, (d) => {
    d.checklist = d.checklist.filter((c) => c.id !== itemId);
  });
}

export async function setDependencies(
  ctx: AppContext,
  id: string,
  deps: string[],
): Promise<Ticket> {
  return updateTicket(ctx, id, { depends_on: [...new Set(deps)] });
}

export interface BulkResult {
  ok: string[];
  failed: { id: string; error: string }[];
}

export async function bulkStatus(
  ctx: AppContext,
  ids: string[],
  status: string,
): Promise<BulkResult> {
  const res: BulkResult = { ok: [], failed: [] };
  for (const id of ids) {
    try {
      await changeTicketStatus(ctx, id, status);
      res.ok.push(id);
    } catch (e) {
      res.failed.push({ id, error: (e as Error).message });
    }
  }
  return res;
}

export async function bulkArchive(
  ctx: AppContext,
  ids: string[],
  archived = true,
): Promise<BulkResult> {
  const res: BulkResult = { ok: [], failed: [] };
  for (const id of ids) {
    try {
      await ctx.repo.archive('ticket', id, archived);
      res.ok.push(id);
    } catch (e) {
      res.failed.push({ id, error: (e as Error).message });
    }
  }
  return res;
}

export function ticketCategory(ctx: AppContext, t: Ticket) {
  return categoryOf(ctx.settings().workflow, t.status);
}

/** Ticket templates: reusable title/checklist presets stored in settings-free form (06 Templates). */
export interface TicketTemplate {
  name: string;
  title: string;
  category: string;
  estimated_seconds: number | null;
  checklist: string[];
}

export const builtinTicketTemplates = (): TicketTemplate[] => [
  {
    name: 'Bugfix',
    title: msg('Fehler: ', 'Bug: '),
    category: 'Bugfix',
    estimated_seconds: 3600,
    checklist: msg(
      'Fehler reproduziert|Ursache analysiert|Fix implementiert|Getestet|Kunde informiert',
      'Bug reproduced|Root cause analysed|Fix implemented|Tested|Customer informed',
    ).split('|'),
  },
  {
    name: 'Feature',
    title: 'Feature: ',
    category: msg('Entwicklung', 'Development'),
    estimated_seconds: 4 * 3600,
    checklist: msg(
      'Anforderungen geklärt|Umsetzung|Tests|Dokumentation|Abnahme durch Kunde',
      'Requirements clarified|Implementation|Tests|Documentation|Customer acceptance',
    ).split('|'),
  },
  {
    name: msg('Wartung', 'Maintenance'),
    title: msg('Wartung: ', 'Maintenance: '),
    category: msg('Wartung', 'Maintenance'),
    estimated_seconds: 3600,
    checklist: msg(
      'Backup geprüft|Updates eingespielt|Funktionstest|Protokoll erstellt',
      'Backup verified|Updates installed|Functional test|Report written',
    ).split('|'),
  },
  {
    name: msg('Support-Anfrage', 'Support request'),
    title: 'Support: ',
    category: 'Support',
    estimated_seconds: 1800,
    checklist: msg(
      'Anfrage verstanden|Gelöst|Rückmeldung an Kunde',
      'Request understood|Solved|Customer notified',
    ).split('|'),
  },
];
