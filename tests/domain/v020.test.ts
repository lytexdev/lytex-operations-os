import { describe, it, expect } from 'vitest';
import { makeEnv, seedBasic } from '../helpers/fixtures';
import { mergeSettings } from '@/core/configuration/settings';
import { PROJECT_KEY_RE } from '@/domain/schemas/entities';
import { migrate } from '@/infrastructure/migrations/migrations';
import {
  createTicket,
  placeTicket,
  migrateLegacyAssignees,
  updateTicketBody,
  readTicketBody,
} from '@/application/use-cases/tickets';
import { createProject } from '@/application/use-cases/projects';
import { deleteEntity, deletionImpact } from '@/application/use-cases/delete';
import { createContact, createInteraction } from '@/application/use-cases/crm';
import { createManualEntry } from '@/application/use-cases/time';
import { filterTickets } from '@/application/queries/tickets';
import { toIso } from '@/shared/date/time';

describe('settings migration v1 → v2', () => {
  it('drops "Blockiert" from the untouched default workflow and replaces the LYTEX assignee', () => {
    const legacy = {
      workflow: ['backlog', 'todo', 'in_progress', 'review', 'blocked', 'done', 'cancelled'].map(
        (key) => ({ key, label: key, category: key === 'blocked' ? 'blocked' : 'open' }),
      ),
      defaultAssignee: 'LYTEX',
    };
    const s = mergeSettings(legacy);
    expect(s.workflow.map((w) => w.key)).not.toContain('blocked');
    expect(s.defaultAssignee).toBe('');
    expect(s.team).toEqual([]);
    expect(s.settingsVersion).toBe(2);
  });
  it('keeps a customised workflow and validates accent colour', () => {
    const s = mergeSettings({
      workflow: [
        { key: 'a', label: 'A', category: 'open' },
        { key: 'blocked', label: 'B', category: 'blocked' },
      ],
      accentColor: 'red',
    });
    expect(s.workflow).toHaveLength(2);
    expect(s.accentColor).toBe('#013e37');
  });
});

describe('project keys with hyphens', () => {
  it('accepts LTX-B, rejects malformed keys', () => {
    for (const k of ['LTX-B', 'AB', 'LTX-B2', 'A1-B2-C3'])
      expect(PROJECT_KEY_RE.test(k)).toBe(true);
    for (const k of ['-AB', 'AB-', 'A--B', 'ab', '1AB', 'A', 'ABCDEFGHIJK'])
      expect(PROJECT_KEY_RE.test(k)).toBe(false);
  });
  it('numbers tickets KEY-n with hyphenated keys', async () => {
    const env = await makeEnv();
    const { project, ticket } = await seedBasic(env, { key: 'LTX-B' });
    expect(project.key).toBe('LTX-B');
    expect(ticket.ticket_number).toBe('LTX-B-1');
    const t2 = await createTicket(env.core.ctx, {
      ...ticket,
      id: undefined,
      title: 'Zwei',
    } as never);
    expect(t2.ticket_number).toBe('LTX-B-2');
  });
});

describe('assignees', () => {
  it('migrates v1 assignee strings to lists', () => {
    const r = migrate('ticket', { schema_version: 1, assignee: 'LYTEX, Sam Muster' });
    expect(r.data['assignees']).toEqual(['LYTEX', 'Sam Muster']);
    expect(r.data['assignee']).toBeUndefined();
    expect(r.data['schema_version']).toBe(2);
  });
  it('replaces LYTEX with me and writes migrated tickets back', async () => {
    const env = await makeEnv();
    const { ticket } = await seedBasic(env);
    const path = env.core.index.pathOf(ticket.id)!;
    const legacy = env.files.files
      .get(path)!
      .replace('schema_version: 2', 'schema_version: 1')
      .replace(/assignees:\n {2}- Alex Beispiel/, 'assignee: LYTEX, Sam Muster');
    env.files.files.set(path, legacy);
    await env.core.rebuildIndex();
    expect(env.core.index.record(ticket.id)!.migrated).toBe(true);
    expect(await migrateLegacyAssignees(env.core.ctx, 'Alex Beispiel')).toBe(1);
    expect(env.core.repo.get('ticket', ticket.id).assignees).toEqual([
      'Alex Beispiel',
      'Sam Muster',
    ]);
    expect(env.files.files.get(path)).toContain('schema_version: 2');
  });
  it('"Meine Arbeit" shows exactly the open tickets assigned to me', async () => {
    const env = await makeEnv();
    const { ticket, project } = await seedBasic(env);
    const other = await createTicket(env.core.ctx, {
      ...ticket,
      id: undefined,
      title: 'Mama',
      assignees: ['Sam Muster'],
      project_id: project.id,
    } as never);
    const both = await createTicket(env.core.ctx, {
      ...ticket,
      id: undefined,
      title: 'Beide',
      assignees: ['Sam Muster', 'Alex Beispiel'],
      status: 'backlog',
      project_id: project.id,
    } as never);
    const mine = filterTickets(
      env.core.index,
      env.settings.workflow,
      { preset: 'mine' },
      '2026-10-23',
      'Alex Beispiel',
      7,
    ).map((t) => t.id);
    expect(mine).toEqual(expect.arrayContaining([ticket.id, both.id]));
    expect(mine).not.toContain(other.id);
  });
});

describe('manual ticket ordering', () => {
  it('appends new tickets and reorders within and across columns', async () => {
    const env = await makeEnv();
    const { ticket } = await seedBasic(env);
    const ctx = env.core.ctx;
    const b = await createTicket(ctx, {
      ...ticket,
      id: undefined,
      title: 'B',
      sort_order: 0,
    } as never);
    const c = await createTicket(ctx, {
      ...ticket,
      id: undefined,
      title: 'C',
      sort_order: 0,
    } as never);
    const order = () =>
      filterTickets(
        env.core.index,
        env.settings.workflow,
        { preset: 'everything' },
        '2026-10-23',
        'x',
        7,
      )
        .filter((t) => t.status === 'todo')
        .map((t) => t.title);
    expect(order()).toEqual([ticket.title, 'B', 'C']);
    await placeTicket(ctx, c.id, 'todo', ticket.id);
    expect(order()).toEqual(['C', ticket.title, 'B']);
    await placeTicket(ctx, ticket.id, 'todo', null);
    expect(order()).toEqual(['C', 'B', ticket.title]);
    await placeTicket(ctx, b.id, 'in_progress', null);
    expect(order()).toEqual(['C', ticket.title]);
    expect(env.core.repo.get('ticket', b.id).status).toBe('in_progress');
  });
});

describe('ticket body (Markdown)', () => {
  it('reads and replaces the body, keeps frontmatter', async () => {
    const env = await makeEnv();
    const { ticket } = await seedBasic(env);
    expect(await readTicketBody(env.core.ctx, ticket.id)).toContain('## Beschreibung');
    await updateTicketBody(env.core.ctx, ticket.id, '# Neu\n\n**fett** ![[bild.png]]\n');
    const text = env.files.files.get(env.core.index.pathOf(ticket.id)!)!;
    expect(text).toContain('**fett** ![[bild.png]]');
    expect(text).toContain(`id: ${ticket.id}`);
    expect(env.core.repo.get('ticket', ticket.id).title).toBe(ticket.title);
  });
});

describe('deletion', () => {
  it('deletes a ticket and removes it from dependencies', async () => {
    const env = await makeEnv();
    const { ticket } = await seedBasic(env);
    const dep = await createTicket(env.core.ctx, {
      ...ticket,
      id: undefined,
      title: 'Abhängig',
      depends_on: [ticket.id],
    } as never);
    expect(deletionImpact(env.core.ctx, 'ticket', ticket.id).unlink.map((u) => u.id)).toEqual([
      dep.id,
    ]);
    await deleteEntity(env.core.ctx, 'ticket', ticket.id);
    expect(env.core.index.hasId(ticket.id)).toBe(false);
    expect(env.core.repo.get('ticket', dep.id).depends_on).toEqual([]);
    expect(env.files.trashed.size).toBe(1);
    expect(env.core.index.issues()).toEqual([]);
  });
  it('blocks deletion when time entries exist (billing data)', async () => {
    const env = await makeEnv();
    const { ticket, project, customer } = await seedBasic(env);
    await createManualEntry(env.core.ctx, {
      project_id: project.id,
      ticket_id: ticket.id,
      description: '',
      start: Date.parse('2026-10-20T08:00:00Z'),
      end: Date.parse('2026-10-20T09:00:00Z'),
      billable: true,
    });
    await expect(deleteEntity(env.core.ctx, 'ticket', ticket.id)).rejects.toThrow(/Zeiteintrag/);
    await expect(deleteEntity(env.core.ctx, 'project', project.id)).rejects.toThrow(/Zeiteintrag/);
    await expect(deleteEntity(env.core.ctx, 'customer', customer.id)).rejects.toThrow(/Projekt/);
    expect(env.files.trashed.size).toBe(0);
  });
  it('deletes a project with its tickets, and a customer with contacts and interactions', async () => {
    const env = await makeEnv();
    const { project, customer } = await seedBasic(env);
    await createContact(env.core.ctx, {
      customer_id: customer.id,
      first_name: 'A',
      last_name: 'B',
      role: '',
      email: '',
      phone: '',
      primary: false,
    });
    await createInteraction(env.core.ctx, {
      customer_id: customer.id,
      project_id: project.id,
      contact_ids: [],
      kind: 'call',
      occurred_at: toIso(Date.now()),
      subject: 'Telefonat',
      follow_up_date: null,
    });
    await deleteEntity(env.core.ctx, 'project', project.id);
    expect(env.core.index.all('ticket')).toHaveLength(0);
    expect(env.core.index.all('interaction')[0]!.project_id).toBeNull();
    const impact = deletionImpact(env.core.ctx, 'customer', customer.id);
    expect(impact.blockers).toEqual([]);
    expect(impact.cascade).toHaveLength(2);
    await deleteEntity(env.core.ctx, 'customer', customer.id);
    expect(env.core.index.size).toBe(0);
    expect(env.core.index.issues()).toEqual([]);
  });
  it('internal project key with hyphen via createProject', async () => {
    const env = await makeEnv();
    const p = await createProject(env.core.ctx, {
      customer_id: null,
      name: 'Intern',
      key: 'LTX-B',
      billing_model: 'internal',
    } as never);
    expect(p.key).toBe('LTX-B');
  });
});

describe('theme colours', () => {
  it('keeps LYTEX green readable in both themes', async () => {
    const { themeColors, contrast, luminance } = await import('@/shared/utilities/color');
    const c = themeColors('#013e37');
    expect(c.light).toBe('#013e37');
    expect(c.onLight).toBe('#ffefb3');
    expect(luminance(c.dark)).toBeGreaterThan(luminance('#013e37'));
    expect(contrast(c.dark, c.onDark)).toBeGreaterThan(3);
    const y = themeColors('#facc15');
    expect(y.onLight).toBe('#111111');
  });
});
