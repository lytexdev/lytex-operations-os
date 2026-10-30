import { describe, it, expect } from 'vitest';
import { makeEnv, seedBasic } from '../helpers/fixtures';
import {
  archiveDoneTickets,
  changeTicketStatus,
  createTicket,
} from '@/application/use-cases/tickets';

const DAY = 86_400_000;

describe('auto-archive done tickets', () => {
  it('archives tickets done for at least N days, leaves others alone', async () => {
    const env = await makeEnv();
    const { ticket, project } = await seedBasic(env);
    const ctx = env.core.ctx;
    const base = { ...ticket, id: undefined, project_id: project.id } as never;
    const open = await createTicket(ctx, { ...(base as object), title: 'Offen' } as never);
    const cancelled = await createTicket(ctx, {
      ...(base as object),
      title: 'Abgebrochen',
    } as never);
    await changeTicketStatus(ctx, ticket.id, 'done');
    await changeTicketStatus(ctx, cancelled.id, 'cancelled');

    env.clock.advance(29 * DAY);
    expect(await archiveDoneTickets(ctx, 30)).toBe(0);
    const recent = await createTicket(ctx, {
      ...(base as object),
      title: 'Frisch erledigt',
    } as never);
    await changeTicketStatus(ctx, recent.id, 'done');

    env.clock.advance(1 * DAY);
    expect(await archiveDoneTickets(ctx, 30)).toBe(1);
    const archived = env.core.repo.get('ticket', ticket.id);
    expect(archived.archived).toBe(true);
    expect(archived.activity.at(-1)!.action).toBe('archived');
    expect(env.core.repo.get('ticket', recent.id).archived).toBe(false);
    expect(env.core.repo.get('ticket', open.id).archived).toBe(false);
    expect(env.core.repo.get('ticket', cancelled.id).archived).toBe(false);
    // Idempotent; 0 disables the rule.
    expect(await archiveDoneTickets(ctx, 30)).toBe(0);
    env.clock.advance(60 * DAY);
    expect(await archiveDoneTickets(ctx, 0)).toBe(0);
  });

  it('runs automatically on startup with the configured number of days', async () => {
    const env = await makeEnv();
    const { ticket } = await seedBasic(env);
    await changeTicketStatus(env.core.ctx, ticket.id, 'done');
    env.clock.advance(31 * DAY);
    env.clock.restartProcess();
    const { OpsCore } = await import('@/core/bootstrap/core');
    const core = new OpsCore(env.files, env.raw, () => env.settings, env.clock);
    const report = await core.start();
    expect(report.archivedTickets).toBe(1);
    expect(core.repo.get('ticket', ticket.id).archived).toBe(true);
  });
});
