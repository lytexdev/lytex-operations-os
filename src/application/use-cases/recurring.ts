import type { AppContext } from '../context';
import type { RecurringTask } from '@/domain/schemas/entities';
import type { CreateInput } from '@/infrastructure/persistence/repository';
import { planOccurrences } from '@/domain/services/recurrence';
import { localDate, toIso } from '@/shared/date/time';
import { ulid } from '@/shared/ids/ulid';
import { planTicket } from './tickets';
import { ValidationError } from '@/domain/errors/errors';
import { msg } from '@/shared/i18n';

export async function createRecurringTask(
  ctx: AppContext,
  input: Omit<CreateInput<'recurring_task'>, 'generated_through'>,
): Promise<RecurringTask> {
  const p = ctx.repo.get('project', input.project_id);
  if (input.recurrence.freq === 'weekly' && input.recurrence.weekdays.some((d) => d < 1 || d > 7))
    throw new ValidationError(msg('Ungültiger Wochentag', 'Invalid weekday'));
  return ctx.repo.create('recurring_task', {
    ...input,
    customer_id: p.customer_id,
    generated_through: null,
  });
}

export interface ReconcileReport {
  created: { taskId: string; date: string; ticketId: string }[];
  skipped: number;
  errors: { taskId: string; error: string }[];
}

/**
 * Generate tickets for all due/missed occurrences. Idempotent: every generated ticket carries
 * `occurrence_key = <taskId>@<date>`; keys already present in the vault are never generated twice,
 * even if `generated_through` was not saved (crash) or the vault was synced from another device.
 */
export async function reconcileRecurring(ctx: AppContext): Promise<ReconcileReport> {
  const report: ReconcileReport = { created: [], skipped: 0, errors: [] };
  const today = localDate(ctx.clock.now());
  for (const task of ctx.index.all('recurring_task')) {
    try {
      await ctx.repo.exclusive(async () => {
        const fresh = ctx.repo.get('recurring_task', task.id);
        const existing = new Set(
          ctx.index
            .all('ticket')
            .filter((t) => t.recurring_task_id === task.id)
            .map((t) => t.occurrence_key),
        );
        const planned = planOccurrences(fresh, today, existing);
        if (!planned.length) {
          report.skipped++;
          return;
        }
        const s = ctx.settings();
        const reserved = new Set<string>();
        const writes = [];
        let offset = 0;
        for (const occ of planned) {
          const w = await planTicket(
            ctx,
            {
              project_id: fresh.project_id,
              title: `${fresh.title} (${occ.date})`,
              status:
                s.workflow.find((x) => x.category === 'open' && x.key === 'todo')?.key ??
                s.workflow.find((x) => x.category === 'open')!.key,
              priority: fresh.priority,
              category: fresh.category,
              due_date: occ.date,
              estimated_seconds: fresh.estimated_seconds,
              billable: fresh.billable,
              assignees: s.defaultAssignee ? [s.defaultAssignee] : [],
              parent_id: null,
              depends_on: [],
              checklist: fresh.checklist.map((text) => ({
                id: ulid(),
                text,
                done: false,
                required: false,
              })),
              sort_order: 0,
              recurring_task_id: fresh.id,
              occurrence_key: occ.key,
              service_id: fresh.service_id,
              tags: ['wiederkehrend'],
              archived: false,
            },
            '',
            reserved,
            offset++,
          );
          writes.push(w);
          report.created.push({ taskId: fresh.id, date: occ.date, ticketId: w.entity.id });
        }
        const last = planned[planned.length - 1]!.date;
        writes.push(
          await ctx.repo.planUpdate('recurring_task', fresh.id, (d) => {
            if (!d.generated_through || d.generated_through < last) d.generated_through = last;
          }),
        );
        await ctx.repo.commit(`recurring ${fresh.id} → ${last}`, writes);
      });
    } catch (e) {
      report.errors.push({ taskId: task.id, error: (e as Error).message });
    }
  }
  return report;
}

export function lastReconcileStamp(ctx: AppContext): string {
  return toIso(ctx.clock.now());
}
