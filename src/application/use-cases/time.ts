import type { AppContext } from '../context';
import type { BillingStatus, Project, Segment, TimeEntry } from '@/domain/schemas/entities';
import { DomainError, ValidationError } from '@/domain/errors/errors';
import { defaultBillable, resolveHourlyRate } from '@/domain/services/rates';
import { assertTimeTransition, isBillingLocked } from '@/domain/policies/billing-status';
import { entryIntervals, findOverlaps, type Interval } from '@/domain/services/overlap';
import { toIso, parseIso } from '@/shared/date/time';
import type { TimerEntryFactory, TimerSession } from '@/domain/services/timer';
import { newId } from '@/shared/ids/entity-ids';
import { msg } from '@/shared/i18n';

export function rateFor(
  ctx: AppContext,
  projectId: string,
  ticketId: string | null,
  serviceId: string | null = null,
) {
  const s = ctx.settings();
  const project = ctx.repo.get('project', projectId);
  const ticket = ticketId ? ctx.index.get('ticket', ticketId) : undefined;
  const customer = project.customer_id ? ctx.index.get('customer', project.customer_id) : undefined;
  const service = ctx.index.get('service', serviceId ?? ticket?.service_id ?? project.service_id);
  const rate = resolveHourlyRate({
    project,
    customer,
    service,
    defaultRateCents: s.defaultHourlyRateCents,
  });
  return {
    ...rate,
    project,
    ticket,
    customer,
    service,
    billableDefault: defaultBillable(project, ticket?.billable, service?.billable),
    currency: project.currency,
  };
}

/** Builds the time entry for a finished timer session (rate snapshot taken now). */
export function timerEntryFactory(ctx: AppContext): TimerEntryFactory {
  return {
    async build(session: TimerSession, segments, duration) {
      const r = rateFor(ctx, session.project_id!, session.ticket_id, session.service_id);
      const segs: Segment[] = segments.map((s) => ({ start: toIso(s.start), end: toIso(s.end) }));
      const now = toIso(ctx.clock.now());
      return {
        id: session.entry_id,
        session_id: session.session_id,
        customer_id: r.project.customer_id,
        project_id: r.project.id,
        ticket_id: session.ticket_id,
        service_id: session.service_id,
        description: session.description,
        started_at: segs[0]?.start ?? now,
        ended_at: segs[segs.length - 1]?.end ?? now,
        duration_seconds: duration,
        segments: segs,
        billable: r.project.billing_model === 'internal' ? false : session.billable,
        rate_cents: r.rate_cents,
        rate_source: r.source,
        currency: r.currency,
        billing_status: 'unbilled',
        billing_batch_id: null,
        source: session.recovered ? 'recovery' : 'timer',
        adjusts_entry_id: null,
        overlap_acknowledged: false,
        history: session.notes.map((n) => ({
          at: n.slice(0, 20),
          action: 'timer',
          detail: n.slice(21),
        })),
      };
    },
  };
}

export interface ManualEntryInput {
  project_id: string;
  ticket_id: string | null;
  service_id?: string | null;
  description: string;
  start: number;
  end: number;
  /** If set, duration differs from end-start (e.g. breaks inside the range). */
  duration_seconds?: number;
  billable: boolean;
  rate_cents?: number | null;
  overlap_acknowledged?: boolean;
}

export function overlapsFor(
  ctx: AppContext,
  intervals: Interval[],
  ignoreId?: string,
): TimeEntry[] {
  return findOverlaps(intervals, ctx.index.all('time_entry'), ignoreId);
}

function checkOverlap(
  ctx: AppContext,
  intervals: Interval[],
  acknowledged: boolean | undefined,
  ignoreId?: string,
): boolean {
  const hits = overlapsFor(ctx, intervals, ignoreId);
  if (!hits.length) return false;
  const policy = ctx.settings().overlapPolicy;
  if (policy === 'block' || !acknowledged) {
    throw new DomainError(
      'overlap',
      msg(
        `Überschneidung mit ${hits.length} bestehenden Einträgen`,
        `Overlaps ${hits.length} existing entries`,
      ),
      hits.map((h) => h.id),
    );
  }
  return true;
}

export function validateManual(input: ManualEntryInput, nowMs: number): string[] {
  const errors: string[] = [];
  if (!input.project_id) errors.push(msg('Projekt ist erforderlich', 'Project is required'));
  if (!(input.end > input.start))
    errors.push(msg('Ende muss nach dem Beginn liegen', 'End must be after start'));
  if (input.end - input.start > 24 * 3600_000)
    errors.push(
      msg('Ein Eintrag darf höchstens 24 Stunden umfassen', 'An entry may span at most 24 hours'),
    );
  if (input.start > nowMs + 60_000)
    errors.push(
      msg('Einträge in der Zukunft sind nicht erlaubt', 'Entries in the future are not allowed'),
    );
  if (input.duration_seconds !== undefined) {
    if (input.duration_seconds <= 0)
      errors.push(msg('Dauer muss größer als 0 sein', 'Duration must be greater than 0'));
    if (input.duration_seconds > Math.round((input.end - input.start) / 1000))
      errors.push(
        msg('Dauer ist länger als der Zeitraum', 'Duration is longer than the time range'),
      );
  }
  if (input.rate_cents != null && input.rate_cents < 0)
    errors.push(msg('Stundensatz darf nicht negativ sein', 'Hourly rate must not be negative'));
  return errors;
}

export async function createManualEntry(
  ctx: AppContext,
  input: ManualEntryInput,
): Promise<TimeEntry> {
  const errors = validateManual(input, ctx.clock.now());
  if (errors.length) throw new ValidationError(errors.join('\n'));
  const r = rateFor(ctx, input.project_id, input.ticket_id, input.service_id ?? null);
  if (input.ticket_id && r.ticket?.project_id !== input.project_id)
    throw new ValidationError(
      msg('Ticket gehört nicht zum Projekt', 'Ticket does not belong to the project'),
    );
  const ack = checkOverlap(
    ctx,
    [{ start: input.start, end: input.end }],
    input.overlap_acknowledged,
  );
  const duration = input.duration_seconds ?? Math.round((input.end - input.start) / 1000);
  return ctx.repo.create('time_entry', {
    id: newId('time_entry'),
    session_id: null,
    customer_id: r.project.customer_id,
    project_id: input.project_id,
    ticket_id: input.ticket_id,
    service_id: input.service_id ?? null,
    description: input.description,
    started_at: toIso(input.start),
    ended_at: toIso(input.end),
    duration_seconds: duration,
    segments:
      duration === Math.round((input.end - input.start) / 1000)
        ? [{ start: toIso(input.start), end: toIso(input.end) }]
        : [],
    billable: r.project.billing_model === 'internal' ? false : input.billable,
    rate_cents: input.rate_cents ?? r.rate_cents,
    rate_source: input.rate_cents != null ? 'manual' : r.source,
    currency: r.currency,
    billing_status: 'unbilled',
    billing_batch_id: null,
    source: 'manual',
    adjusts_entry_id: null,
    overlap_acknowledged: ack,
    history: [{ at: toIso(ctx.clock.now()), action: 'created', detail: msg('manuell', 'manual') }],
  });
}

export interface EntryEdit {
  project_id?: string;
  ticket_id?: string | null;
  description?: string;
  start?: number;
  end?: number;
  duration_seconds?: number;
  billable?: boolean;
  rate_cents?: number;
  overlap_acknowledged?: boolean;
  reason?: string;
}

/** Edit an entry that is not yet in billing. Every change is recorded in the entry history. */
export async function editEntry(
  ctx: AppContext,
  id: string,
  edit: EntryEdit,
  expectedUpdatedAt?: string,
): Promise<TimeEntry> {
  const cur = ctx.repo.get('time_entry', id);
  if (isBillingLocked(cur.billing_status)) {
    throw new DomainError(
      'entry_locked',
      msg(
        'Abgerechnete oder reservierte Einträge können nicht direkt geändert werden. Bitte eine Korrekturbuchung anlegen.',
        'Invoiced or reserved entries cannot be changed directly. Please create an adjustment.',
      ),
    );
  }
  if (cur.source === 'adjustment')
    throw new DomainError(
      'entry_locked',
      msg('Korrekturbuchungen können nicht bearbeitet werden', 'Adjustments cannot be edited'),
    );
  const start = edit.start ?? parseIso(cur.started_at);
  const end = edit.end ?? parseIso(cur.ended_at);
  const timeChanged = edit.start !== undefined || edit.end !== undefined;
  const duration =
    edit.duration_seconds ??
    (timeChanged ? Math.round((end - start) / 1000) : cur.duration_seconds);
  const projectId = edit.project_id ?? cur.project_id;
  const ticketId = edit.ticket_id !== undefined ? edit.ticket_id : cur.ticket_id;
  const errs = validateManual(
    {
      project_id: projectId,
      ticket_id: ticketId,
      description: '',
      start,
      end,
      duration_seconds: duration,
      billable: true,
    },
    ctx.clock.now(),
  );
  if (errs.length) throw new ValidationError(errs.join('\n'));
  const project = ctx.repo.get('project', projectId);
  if (ticketId && ctx.index.get('ticket', ticketId)?.project_id !== projectId)
    throw new ValidationError(
      msg('Ticket gehört nicht zum Projekt', 'Ticket does not belong to the project'),
    );
  let ack = cur.overlap_acknowledged;
  if (timeChanged)
    ack = checkOverlap(ctx, [{ start, end }], edit.overlap_acknowledged, id) || false;
  return ctx.repo.update(
    'time_entry',
    id,
    (d) => {
      const changes: string[] = [];
      const note = (field: string, from: unknown, to: unknown) => {
        if (JSON.stringify(from) !== JSON.stringify(to))
          changes.push(`${field}: ${String(from)} → ${String(to)}`);
      };
      note('project_id', d.project_id, projectId);
      note('ticket_id', d.ticket_id, ticketId);
      note('started_at', d.started_at, toIso(start));
      note('ended_at', d.ended_at, toIso(end));
      note('duration_seconds', d.duration_seconds, duration);
      if (edit.description !== undefined) note('description', d.description, edit.description);
      if (edit.billable !== undefined) note('billable', d.billable, edit.billable);
      if (edit.rate_cents !== undefined) note('rate_cents', d.rate_cents, edit.rate_cents);
      d.project_id = projectId;
      d.customer_id = project.customer_id;
      d.ticket_id = ticketId;
      d.started_at = toIso(start);
      d.ended_at = toIso(end);
      d.duration_seconds = duration;
      if (timeChanged)
        d.segments =
          duration === Math.round((end - start) / 1000)
            ? [{ start: toIso(start), end: toIso(end) }]
            : [];
      if (edit.description !== undefined) d.description = edit.description;
      if (edit.billable !== undefined)
        d.billable = project.billing_model === 'internal' ? false : edit.billable;
      if (edit.rate_cents !== undefined) {
        d.rate_cents = edit.rate_cents;
        d.rate_source = 'manual';
      }
      d.overlap_acknowledged = ack;
      if (changes.length)
        d.history.push({
          at: toIso(ctx.clock.now()),
          action: 'edit',
          detail: `${changes.join('; ')}${edit.reason ? ` – ${edit.reason}` : ''}`,
        });
    },
    { expectedUpdatedAt },
  );
}

/**
 * Correction for an invoiced entry: creates an adjustment entry (±seconds, same rate) that will be
 * billed in a later batch, and marks the original as `adjusted`. The original stays unchanged.
 */
export async function createAdjustment(
  ctx: AppContext,
  entryId: string,
  deltaSeconds: number,
  reason: string,
): Promise<TimeEntry> {
  if (!reason.trim())
    throw new ValidationError(msg('Begründung ist erforderlich', 'Reason is required'));
  if (!Number.isInteger(deltaSeconds) || deltaSeconds === 0)
    throw new ValidationError(msg('Korrektur muss ungleich 0 sein', 'Adjustment must not be 0'));
  const orig = ctx.repo.get('time_entry', entryId);
  if (orig.billing_status !== 'invoiced' && orig.billing_status !== 'adjusted') {
    throw new DomainError(
      'adjust_not_invoiced',
      msg(
        'Korrekturbuchungen sind nur für abgerechnete Einträge nötig – nicht abgerechnete Einträge direkt bearbeiten.',
        'Adjustments are only needed for invoiced entries – edit uninvoiced entries directly.',
      ),
    );
  }
  if (orig.duration_seconds + deltaSeconds + sumAdjustments(ctx, entryId) < 0)
    throw new ValidationError(
      msg(
        'Korrektur würde eine negative Gesamtdauer ergeben',
        'Adjustment would result in a negative total duration',
      ),
    );
  return ctx.repo.exclusive(async () => {
    const now = toIso(ctx.clock.now());
    const adj = await ctx.repo.planCreate('time_entry', {
      session_id: null,
      customer_id: orig.customer_id,
      project_id: orig.project_id,
      ticket_id: orig.ticket_id,
      service_id: orig.service_id,
      description: msg(
        `Korrektur zu ${orig.id}: ${reason.trim()}`,
        `Adjustment for ${orig.id}: ${reason.trim()}`,
      ),
      started_at: now,
      ended_at: now,
      duration_seconds: deltaSeconds,
      segments: [],
      billable: orig.billable,
      rate_cents: orig.rate_cents,
      rate_source: orig.rate_source,
      currency: orig.currency,
      billing_status: 'unbilled',
      billing_batch_id: null,
      source: 'adjustment',
      adjusts_entry_id: orig.id,
      overlap_acknowledged: false,
      history: [{ at: now, action: 'created', detail: reason.trim() }],
    });
    const writes = [adj];
    if (orig.billing_status === 'invoiced') {
      writes.push(
        await ctx.repo.planUpdate('time_entry', orig.id, (d) => {
          assertTimeTransition(d.billing_status, 'adjusted');
          d.billing_status = 'adjusted';
          d.history.push({
            at: now,
            action: 'adjusted',
            detail: `${adj.entity.id}: ${deltaSeconds} s – ${reason.trim()}`,
          });
        }),
      );
    } else {
      writes.push(
        await ctx.repo.planUpdate('time_entry', orig.id, (d) => {
          d.history.push({
            at: now,
            action: 'adjusted',
            detail: `${adj.entity.id}: ${deltaSeconds} s – ${reason.trim()}`,
          });
        }),
      );
    }
    await ctx.repo.commit('adjust time entry', writes);
    return adj.entity as TimeEntry;
  });
}

function sumAdjustments(ctx: AppContext, entryId: string): number {
  return ctx.index
    .all('time_entry')
    .filter((e) => e.adjusts_entry_id === entryId)
    .reduce((a, e) => a + e.duration_seconds, 0);
}

export async function setBillingStatus(
  ctx: AppContext,
  ids: string[],
  to: Extract<BillingStatus, 'unbilled' | 'approved' | 'written_off'>,
  reason = '',
): Promise<{ ok: string[]; failed: { id: string; error: string }[] }> {
  const res = { ok: [] as string[], failed: [] as { id: string; error: string }[] };
  for (const id of ids) {
    try {
      await ctx.repo.update('time_entry', id, (d) => {
        if (to === 'approved' && !d.billable)
          throw new DomainError(
            'not_billable',
            msg(
              'Nicht abrechenbare Einträge können nicht freigegeben werden',
              'Non-billable entries cannot be approved',
            ),
          );
        assertTimeTransition(d.billing_status, to);
        d.history.push({
          at: toIso(ctx.clock.now()),
          action: 'billing_status',
          detail: `${d.billing_status} → ${to}${reason ? ` – ${reason}` : ''}`,
        });
        d.billing_status = to;
      });
      res.ok.push(id);
    } catch (e) {
      res.failed.push({ id, error: (e as Error).message });
    }
  }
  return res;
}

export async function archiveEntry(ctx: AppContext, id: string): Promise<void> {
  const e = ctx.repo.get('time_entry', id);
  if (isBillingLocked(e.billing_status))
    throw new DomainError(
      'entry_locked',
      msg(
        'Abgerechnete Einträge können nicht archiviert werden',
        'Invoiced entries cannot be archived',
      ),
    );
  await ctx.repo.update('time_entry', id, (d) => {
    d.archived = true;
    d.history.push({ at: toIso(ctx.clock.now()), action: 'archived', detail: '' });
  });
}

export function entryIntervalsOf(e: TimeEntry): Interval[] {
  return entryIntervals(e);
}

export function projectIsBillable(p: Project): boolean {
  return p.billing_model !== 'internal';
}
