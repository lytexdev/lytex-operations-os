import type { AppContext } from '../context';
import type { Project } from '@/domain/schemas/entities';
import type { CreateInput } from '@/infrastructure/persistence/repository';
import { ValidationError } from '@/domain/errors/errors';
import { nextProjectNumber, suggestProjectKey } from './numbering';
import { ulid } from '@/shared/ids/ulid';
import { toIso, localDate } from '@/shared/date/time';
import { joinPath } from '@/infrastructure/persistence/file-store';
import { msg } from '@/shared/i18n';

export type ProjectInput = Omit<CreateInput<'project'>, 'project_number' | 'key'> & {
  project_number?: string;
  key?: string;
};

export function takenKeys(ctx: AppContext, exceptId?: string): Set<string> {
  return new Set(
    ctx.index
      .all('project')
      .filter((p) => p.id !== exceptId)
      .map((p) => p.key),
  );
}

export function validateProjectRules(
  p: Pick<
    Project,
    | 'billing_model'
    | 'billing_unit'
    | 'daily_rate_cents'
    | 'fixed_price_cents'
    | 'retainer_monthly_fee_cents'
    | 'customer_id'
  >,
): { field: 'customer' | 'fixed' | 'retFee' | 'dayRate'; message: string }[] {
  const errors: { field: 'customer' | 'fixed' | 'retFee' | 'dayRate'; message: string }[] = [];
  if (p.billing_model !== 'internal' && !p.customer_id)
    errors.push({
      field: 'customer',
      message: msg(
        'Kundenprojekte benötigen einen Kunden (oder Abrechnungsmodell „intern“).',
        'Customer projects need a customer (or billing model “internal”).',
      ),
    });
  if (p.billing_model === 'fixed_price' && p.fixed_price_cents == null)
    errors.push({
      field: 'fixed',
      message: msg(
        'Festpreisprojekte benötigen einen Festpreis.',
        'Fixed-price projects need a fixed price.',
      ),
    });
  if (p.billing_model === 'retainer' && p.retainer_monthly_fee_cents == null)
    errors.push({
      field: 'retFee',
      message: msg(
        'Retainer benötigen eine monatliche Pauschale.',
        'Retainers need a monthly fee.',
      ),
    });
  if (p.billing_unit === 'day' && p.daily_rate_cents == null)
    errors.push({
      field: 'dayRate',
      message: msg(
        'Abrechnung in Tagen benötigt einen vertraglichen Tagessatz.',
        'Billing per day needs a contractual daily rate.',
      ),
    });
  return errors;
}

export async function createProject(
  ctx: AppContext,
  input: ProjectInput,
  description = '',
): Promise<Project> {
  if (input.customer_id) ctx.repo.get('customer', input.customer_id);
  const taken = takenKeys(ctx);
  const key = (input.key || suggestProjectKey(input.name, taken)).toUpperCase();
  if (taken.has(key))
    throw new ValidationError(
      msg(`Projektkürzel ${key} ist bereits vergeben`, `Project key ${key} is already taken`),
    );
  const errors = validateProjectRules(input);
  if (errors.length) throw new ValidationError(errors.map((e) => e.message).join('\n'));
  const project = await ctx.repo.create(
    'project',
    { ...input, key, project_number: input.project_number || nextProjectNumber(ctx.index) },
    { description },
  );
  const folder = ctx.paths.projectFolder(project.id);
  if (folder)
    for (const sub of PROJECT_SUBFOLDERS) await ctx.files.ensureFolder(joinPath(folder, sub));
  return project;
}

export const PROJECT_SUBFOLDERS = ['Tickets', 'Meetings', 'Documentation', 'Attachments'] as const;

export async function updateProject(
  ctx: AppContext,
  id: string,
  patch: Partial<Project>,
  expectedUpdatedAt?: string,
): Promise<Project> {
  const cur = ctx.repo.get('project', id);
  const merged = { ...cur, ...patch };
  if (patch.key && patch.key !== cur.key) {
    if (takenKeys(ctx, id).has(patch.key))
      throw new ValidationError(
        msg(
          `Projektkürzel ${patch.key} ist bereits vergeben`,
          `Project key ${patch.key} is already taken`,
        ),
      );
    if (ctx.index.all('ticket').some((t) => t.project_id === id))
      throw new ValidationError(
        msg(
          'Das Kürzel kann nicht geändert werden, wenn bereits Tickets existieren.',
          'The key cannot be changed once tickets exist.',
        ),
      );
  }
  const errors = validateProjectRules(merged);
  if (errors.length) throw new ValidationError(errors.map((e) => e.message).join('\n'));
  return ctx.repo.update(
    'project',
    id,
    (d) => {
      const next = { ...d, ...patch, id: d.id, type: d.type, created_at: d.created_at };
      if (next.status === 'completed' && !next.completed_date)
        next.completed_date = localDate(ctx.clock.now());
      return next;
    },
    { expectedUpdatedAt },
  );
}

export async function addMilestone(
  ctx: AppContext,
  projectId: string,
  title: string,
  dueDate: string | null,
): Promise<Project> {
  if (!title.trim()) throw new ValidationError(msg('Titel ist erforderlich', 'Title is required'));
  return ctx.repo.update('project', projectId, (d) => {
    d.milestones.push({ id: ulid(), title: title.trim(), due_date: dueDate, done: false });
  });
}

export async function toggleMilestone(
  ctx: AppContext,
  projectId: string,
  milestoneId: string,
): Promise<Project> {
  return ctx.repo.update('project', projectId, (d) => {
    const m = d.milestones.find((x) => x.id === milestoneId);
    if (m) m.done = !m.done;
  });
}

export async function removeMilestone(
  ctx: AppContext,
  projectId: string,
  milestoneId: string,
): Promise<Project> {
  return ctx.repo.update('project', projectId, (d) => {
    d.milestones = d.milestones.filter((x) => x.id !== milestoneId);
  });
}

export function nowIso(ctx: AppContext): string {
  return toIso(ctx.clock.now());
}
