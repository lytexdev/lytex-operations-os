import { describe, it, expect } from 'vitest';
import { makeEnv, seedBasic, restart } from '../helpers/fixtures';
import {
  changeTicketStatus,
  createTicket,
  updateTicket,
  addChecklistItem,
  toggleChecklistItem,
  bulkStatus,
  addComment,
} from '@/application/use-cases/tickets';
import { createProject } from '@/application/use-cases/projects';
import { checkCustomerDuplicates, createContact } from '@/application/use-cases/crm';
import { createRecurringTask, reconcileRecurring } from '@/application/use-cases/recurring';

describe('projects', () => {
  it('numbers, keys and billing-model rules', async () => {
    const env = await makeEnv();
    const { project, customer } = await seedBasic(env);
    expect(project.project_number).toBe('P-0001');
    expect(project.key).toBe('WR');
    const folder = env.core.paths.projectFolder(project.id)!;
    expect(env.files.folders.has(`${folder}/Attachments`)).toBe(true);
    expect(env.files.folders.has(`${folder}/Documentation`)).toBe(true);
    const base = {
      ...project,
      id: undefined,
      project_number: undefined,
      key: undefined,
      created_at: undefined,
    } as never;
    await expect(
      createProject(env.core.ctx, {
        ...(base as object),
        name: 'Fix',
        customer_id: customer.id,
        billing_model: 'fixed_price',
        fixed_price_cents: null,
      } as never),
    ).rejects.toThrow(/Festpreis/);
    await expect(
      createProject(env.core.ctx, {
        ...(base as object),
        name: 'Kein Kunde',
        customer_id: null,
        billing_model: 'time_and_materials',
      } as never),
    ).rejects.toThrow(/Kunden/);
    const internal = await createProject(env.core.ctx, {
      ...(base as object),
      name: 'LYTEX Intern',
      customer_id: null,
      billing_model: 'internal',
    } as never);
    expect(internal.project_number).toBe('P-0002');
    expect(internal.key).toBe('LI');
  });
});

describe('tickets', () => {
  it('numbers per project, derives customer, logs activity', async () => {
    const env = await makeEnv();
    const { ticket, project, customer } = await seedBasic(env);
    expect(ticket.ticket_number).toBe('WR-1');
    expect(ticket.customer_id).toBe(customer.id);
    const t2 = await createTicket(env.core.ctx, {
      ...ticket,
      id: undefined,
      title: 'Zweites',
      project_id: project.id,
    } as never);
    expect(t2.ticket_number).toBe('WR-2');
    const moved = await changeTicketStatus(env.core.ctx, ticket.id, 'done');
    expect(moved.completed_at).not.toBeNull();
    expect(moved.activity.at(-1)!.detail).toBe('todo → done');
    const reopened = await changeTicketStatus(env.core.ctx, ticket.id, 'in_progress');
    expect(reopened.completed_at).toBeNull();
    await addComment(env.core.ctx, ticket.id, 'Hallo');
    expect(env.core.repo.get('ticket', ticket.id).activity.at(-1)!.action).toBe('comment');
  });

  it('enforces configured definition of done', async () => {
    const env = await makeEnv();
    env.settings.doneRules = {
      requireChecklistComplete: 'all_items',
      requireDependenciesResolved: true,
      requireEstimate: false,
      requireTrackedTime: false,
    };
    const { ticket, project } = await seedBasic(env);
    const t = await addChecklistItem(env.core.ctx, ticket.id, 'Test');
    await expect(changeTicketStatus(env.core.ctx, ticket.id, 'done')).rejects.toThrow(/Checkliste/);
    await toggleChecklistItem(env.core.ctx, ticket.id, t.checklist[0]!.id);
    const dep = await createTicket(env.core.ctx, {
      ...ticket,
      id: undefined,
      title: 'Vorher',
      project_id: project.id,
    } as never);
    await updateTicket(env.core.ctx, ticket.id, { depends_on: [dep.id] });
    await expect(changeTicketStatus(env.core.ctx, ticket.id, 'done')).rejects.toThrow(
      /Abhängigkeiten/,
    );
    await changeTicketStatus(env.core.ctx, dep.id, 'done');
    await expect(changeTicketStatus(env.core.ctx, ticket.id, 'done')).resolves.toBeTruthy();
    await expect(updateTicket(env.core.ctx, dep.id, { depends_on: [ticket.id] })).rejects.toThrow(
      /Zirkulär/,
    );
  });

  it('bulk status reports per-ticket failures', async () => {
    const env = await makeEnv();
    const { ticket } = await seedBasic(env);
    const r = await bulkStatus(env.core.ctx, [ticket.id, 'TKT-NOTEXIST1'], 'review');
    expect(r.ok).toEqual([ticket.id]);
    expect(r.failed).toHaveLength(1);
  });

  it('rejects unknown statuses', async () => {
    const env = await makeEnv();
    const { ticket } = await seedBasic(env);
    await expect(changeTicketStatus(env.core.ctx, ticket.id, 'nope')).rejects.toThrow(
      /Unbekannter Status/,
    );
  });
});

describe('crm', () => {
  it('duplicate warnings and primary contact uniqueness', async () => {
    const env = await makeEnv();
    const { customer } = await seedBasic(env);
    expect(
      checkCustomerDuplicates(env.core.ctx, {
        name: 'Muster',
        email: '',
        website: '',
        vat_id: '',
        phone: '',
      }),
    ).toHaveLength(1);
    const a = await createContact(env.core.ctx, {
      customer_id: customer.id,
      first_name: 'Anna',
      last_name: 'A',
      role: '',
      email: '',
      phone: '',
      primary: true,
    });
    await createContact(env.core.ctx, {
      customer_id: customer.id,
      first_name: 'Bernd',
      last_name: 'B',
      role: '',
      email: '',
      phone: '',
      primary: true,
    });
    expect(env.core.repo.get('contact', a.id).primary).toBe(false);
  });
});

describe('recurring tasks', () => {
  it('generates missed and upcoming occurrences exactly once, also after restart', async () => {
    const env = await makeEnv();
    const { project } = await seedBasic(env);
    await createRecurringTask(env.core.ctx, {
      title: 'Backup prüfen',
      customer_id: null,
      project_id: project.id,
      service_id: null,
      recurrence: { freq: 'weekly', interval: 1, weekdays: [1], day_of_month: null },
      start_date: '2026-10-01',
      end_date: null,
      lead_days: 7,
      estimated_seconds: 1800,
      priority: 'normal',
      billable: true,
      active: true,
      category: 'Wartung',
      checklist: ['Backup-Log prüfen', 'Restore-Test'],
    });
    const r1 = await reconcileRecurring(env.core.ctx);
    // today 2026-10-23 (Fri), horizon 10-30 → Mondays 10-05, 10-12, 10-19, 10-26
    expect(r1.created.map((c) => c.date)).toEqual([
      '2026-10-05',
      '2026-10-12',
      '2026-10-19',
      '2026-10-26',
    ]);
    const tickets = env.core.index.all('ticket').filter((t) => t.recurring_task_id);
    expect(new Set(tickets.map((t) => t.ticket_number)).size).toBe(4);
    expect(tickets[0]!.checklist).toHaveLength(2);
    const r2 = await reconcileRecurring(env.core.ctx);
    expect(r2.created).toHaveLength(0);
    // Simulate lost generated_through (e.g. crash): occurrence keys still prevent duplicates.
    const task = env.core.index.all('recurring_task')[0]!;
    await env.core.repo.update('recurring_task', task.id, (d) => {
      d.generated_through = null;
    });
    const r3 = await reconcileRecurring(env.core.ctx);
    expect(r3.created).toHaveLength(0);
    env.clock.advance(14 * 86400_000);
    const env2 = await restart(env);
    const r4 = await reconcileRecurring(env2.core.ctx);
    expect(r4.created.map((c) => c.date)).toEqual(['2026-11-02', '2026-11-09']);
  });
});
