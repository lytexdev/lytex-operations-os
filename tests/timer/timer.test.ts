import { describe, it, expect } from 'vitest';
import { makeEnv, restart, seedBasic, H, MIN } from '../helpers/fixtures';

async function setup() {
  const env = await makeEnv();
  const seed = await seedBasic(env);
  const ctx = {
    project_id: seed.project.id,
    ticket_id: seed.ticket.id,
    customer_id: seed.customer.id,
    service_id: null,
    description: 'Arbeit',
    billable: true,
  };
  return { env, seed, ctx };
}

describe('TimerEngine – basic lifecycle', () => {
  it('start → stop creates exactly one entry with rate snapshot', async () => {
    const { env, ctx } = await setup();
    await env.core.timer.start(ctx);
    env.clock.advance(90 * MIN);
    const res = await env.core.timer.stop();
    expect(res.kind).toBe('committed');
    const entries = env.core.index.all('time_entry');
    expect(entries).toHaveLength(1);
    const e = entries[0]!;
    expect(e.duration_seconds).toBe(5400);
    expect(e.rate_cents).toBe(7000);
    expect(e.rate_source).toBe('default');
    expect(e.source).toBe('timer');
    expect(e.started_at).toBe('2026-10-23T08:00:00Z');
    expect(e.ended_at).toBe('2026-10-23T09:30:00Z');
    expect(env.core.timer.stateName).toBe('idle');
  });

  it('elapsed time is derived from timestamps, not ticks', async () => {
    const { env, ctx } = await setup();
    await env.core.timer.start(ctx);
    env.clock.advance(3 * H); // no heartbeats at all
    expect(env.core.timer.elapsedSeconds()).toBe(3 * 3600);
  });

  it('pause/resume excludes paused time and keeps segments', async () => {
    const { env, ctx } = await setup();
    await env.core.timer.start(ctx);
    env.clock.advance(30 * MIN);
    await env.core.timer.pause();
    expect(env.core.timer.stateName).toBe('paused');
    env.clock.advance(60 * MIN);
    expect(env.core.timer.elapsedSeconds()).toBe(1800);
    await env.core.timer.resume();
    env.clock.advance(15 * MIN);
    await env.core.timer.stop();
    const e = env.core.index.all('time_entry')[0]!;
    expect(e.duration_seconds).toBe(45 * 60);
    expect(e.segments).toHaveLength(2);
    expect(e.ended_at).toBe('2026-10-23T09:45:00Z');
  });

  it('repeated start is rejected (single active timer)', async () => {
    const { env, ctx } = await setup();
    await env.core.timer.start(ctx);
    await expect(env.core.timer.start(ctx)).rejects.toThrow(/läuft bereits/);
  });

  it('repeated and concurrent stop create no duplicates', async () => {
    const { env, ctx } = await setup();
    await env.core.timer.start(ctx);
    env.clock.advance(2 * H);
    const [a, b] = await Promise.all([env.core.timer.stop(), env.core.timer.stop()]);
    const c = await env.core.timer.stop();
    expect(a.kind).toBe('committed');
    expect(b.kind).toBe('nothing_to_stop');
    expect(c.kind).toBe('nothing_to_stop');
    expect(env.core.index.all('time_entry')).toHaveLength(1);
  });

  it('too short sessions are not committed without confirmation', async () => {
    const { env, ctx } = await setup();
    await env.core.timer.start(ctx);
    env.clock.advance(10_000);
    const r = await env.core.timer.stop();
    expect(r.kind).toBe('too_short');
    expect(env.core.timer.stateName).toBe('running');
    const r2 = await env.core.timer.stop({ allowShort: true });
    expect(r2.kind).toBe('committed');
  });

  it('discard removes session without entry', async () => {
    const { env, ctx } = await setup();
    await env.core.timer.start(ctx);
    env.clock.advance(H);
    await env.core.timer.discard();
    expect(env.core.timer.stateName).toBe('idle');
    expect(env.core.index.all('time_entry')).toHaveLength(0);
  });

  it('changing ticket/project/billable while running applies to entry', async () => {
    const { env, ctx, seed } = await setup();
    await env.core.timer.start({ ...ctx, ticket_id: null });
    await env.core.timer.update({ ticket_id: seed.ticket.id, description: 'Neu', billable: false });
    env.clock.advance(H);
    await env.core.timer.stop();
    const e = env.core.index.all('time_entry')[0]!;
    expect(e.ticket_id).toBe(seed.ticket.id);
    expect(e.description).toBe('Neu');
    expect(e.billable).toBe(false);
  });

  it('requires a project', async () => {
    const { env, ctx } = await setup();
    await expect(env.core.timer.start({ ...ctx, project_id: null })).rejects.toThrow(/Projekt/);
  });
});

describe('TimerEngine – persistence & recovery', () => {
  it('survives a plugin reload (quick restart, heartbeat fresh)', async () => {
    const { env, ctx } = await setup();
    await env.core.timer.start(ctx);
    env.clock.advance(20 * MIN);
    await env.core.timer.heartbeat();
    env.clock.advance(30_000);
    const env2 = await restart(env);
    expect(env2.core.timer.stateName).toBe('running');
    env2.clock.advance(10 * MIN);
    await env2.core.timer.stop();
    expect(env2.core.index.all('time_entry')[0]!.duration_seconds).toBe(30 * 60 + 30);
  });

  it('after crash/long shutdown enters RECOVERING and does not count offline time', async () => {
    const { env, ctx } = await setup();
    await env.core.timer.start(ctx);
    env.clock.advance(60 * MIN);
    await env.core.timer.heartbeat(); // last sign of life at 09:00
    env.clock.advance(14 * H); // app closed overnight
    const env2 = await restart(env);
    expect(env2.core.timer.stateName).toBe('recovering');
    expect(env2.core.timer.elapsedSeconds()).toBe(3600);
    expect(env2.core.timer.session!.gap!.from).toBe(Date.parse('2026-10-23T09:00:00Z'));
    await expect(env2.core.timer.stop()).rejects.toThrow(/Wiederherstellung/);
    const r = await env2.core.timer.recover({ kind: 'exclude_gap', then: 'stop' });
    expect(r?.kind).toBe('committed');
    const e = env2.core.index.all('time_entry')[0]!;
    expect(e.duration_seconds).toBe(3600);
    expect(e.source).toBe('recovery');
  });

  it('recovery with user-confirmed end time', async () => {
    const { env, ctx } = await setup();
    await env.core.timer.start(ctx);
    env.clock.advance(60 * MIN);
    await env.core.timer.heartbeat();
    env.clock.advance(5 * H);
    const env2 = await restart(env);
    const gap = env2.core.timer.session!.gap!;
    await env2.core.timer.recover({ kind: 'end_at', at: gap.from + 20 * MIN });
    expect(env2.core.index.all('time_entry')[0]!.duration_seconds).toBe(80 * 60);
  });

  it('recovery end_at outside the gap is rejected', async () => {
    const { env, ctx } = await setup();
    await env.core.timer.start(ctx);
    env.clock.advance(H);
    await env.core.timer.heartbeat();
    env.clock.advance(5 * H);
    const env2 = await restart(env);
    await expect(
      env2.core.timer.recover({ kind: 'end_at', at: Date.parse('2026-10-23T07:00:00Z') }),
    ).rejects.toThrow();
  });

  it('recovery include_gap counts offline time only when explicitly confirmed', async () => {
    const { env, ctx } = await setup();
    await env.core.timer.start(ctx);
    env.clock.advance(H);
    await env.core.timer.heartbeat();
    env.clock.advance(H);
    const env2 = await restart(env);
    await env2.core.timer.recover({ kind: 'include_gap', then: 'resume' });
    expect(env2.core.timer.stateName).toBe('running');
    env2.clock.advance(30 * MIN);
    await env2.core.timer.stop();
    expect(env2.core.index.all('time_entry')[0]!.duration_seconds).toBe(150 * 60);
  });

  it('recovery discard drops the session', async () => {
    const { env, ctx } = await setup();
    await env.core.timer.start(ctx);
    env.clock.advance(H);
    env.clock.advance(5 * H);
    const env2 = await restart(env);
    await env2.core.timer.recover({ kind: 'discard' });
    expect(env2.core.timer.stateName).toBe('idle');
    expect(env2.core.index.all('time_entry')).toHaveLength(0);
  });

  it('paused session survives reboot without recovery prompt', async () => {
    const { env, ctx } = await setup();
    await env.core.timer.start(ctx);
    env.clock.advance(H);
    await env.core.timer.pause();
    env.clock.advance(24 * H);
    const env2 = await restart(env);
    expect(env2.core.timer.stateName).toBe('paused');
    expect(env2.core.timer.elapsedSeconds()).toBe(3600);
  });

  it('crash after entry written but before session cleared → no duplicate on restart', async () => {
    const { env, ctx } = await setup();
    await env.core.timer.start(ctx);
    env.clock.advance(H);
    // Fail the step-3 write (session clear) after the entry file was created.
    let timerWrites = 0;
    env.raw.failNextWrite = {
      match: (k) => {
        if (!k.startsWith('timer')) return false;
        timerWrites++;
        return timerWrites === 2;
      },
    };
    await expect(env.core.timer.stop()).rejects.toThrow(/Simulated/);
    expect(env.core.index.all('time_entry')).toHaveLength(1);
    const env2 = await restart(env);
    expect(env2.core.timer.stateName).toBe('idle');
    expect(env2.core.index.all('time_entry')).toHaveLength(1);
  });

  it('crash after "stopping" persisted but before entry written → entry written exactly once on restart', async () => {
    const { env, ctx } = await setup();
    await env.core.timer.start(ctx);
    env.clock.advance(H);
    env.files.failNextWrite = { match: (p) => p.includes('03 Time/Entries') };
    await expect(env.core.timer.stop()).rejects.toThrow(/Simulated/);
    expect(env.core.index.all('time_entry')).toHaveLength(0);
    env.clock.advance(5 * H);
    const env2 = await restart(env);
    expect(env2.core.timer.stateName).toBe('idle');
    const entries = env2.core.index.all('time_entry');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.duration_seconds).toBe(3600); // offline time not counted
  });

  it('torn write of the session slot falls back to the previous valid state', async () => {
    const { env, ctx } = await setup();
    await env.core.timer.start(ctx);
    env.clock.advance(10 * MIN);
    env.raw.failNextWrite = { match: (k) => k.startsWith('timer'), truncateTo: 20 };
    await expect(env.core.timer.pause()).rejects.toThrow();
    const env2 = await restart(env);
    // Last valid state was "running" from start → resumes as running (heartbeat fresh enough).
    expect(['running', 'recovering']).toContain(env2.core.timer.stateName);
    expect(env2.core.timer.session!.session_id).toBe(env.core.timer.session!.session_id);
  });
});

describe('TimerEngine – clocks', () => {
  it('detects suspend (wall advances, monotonic does not) and asks for recovery', async () => {
    const { env, ctx } = await setup();
    await env.core.timer.start(ctx);
    env.clock.advance(30 * MIN);
    await env.core.timer.heartbeat();
    env.clock.suspend(2 * H);
    await env.core.timer.heartbeat();
    expect(env.core.timer.stateName).toBe('recovering');
    expect(env.core.timer.elapsedSeconds()).toBe(1800);
    await env.core.timer.recover({ kind: 'exclude_gap', then: 'resume' });
    env.clock.advance(30 * MIN);
    await env.core.timer.stop();
    expect(env.core.index.all('time_entry')[0]!.duration_seconds).toBe(3600);
  });

  it('wall clock moved backwards: monotonic clock preserves worked time', async () => {
    const { env, ctx } = await setup();
    await env.core.timer.start(ctx);
    env.clock.advance(30 * MIN);
    await env.core.timer.heartbeat();
    env.clock.advance(10 * MIN);
    env.clock.jumpWall(-60 * MIN);
    await env.core.timer.heartbeat();
    expect(env.core.timer.stateName).toBe('running');
    env.clock.advance(20 * MIN);
    await env.core.timer.stop();
    expect(env.core.index.all('time_entry')[0]!.duration_seconds).toBe(60 * 60);
  });

  it('long-running sessions (>24h) compute correctly', async () => {
    const { env, ctx } = await setup();
    await env.core.timer.start(ctx);
    for (let i = 0; i < 26 * 4; i++) {
      env.clock.advance(15 * MIN);
      await env.core.timer.heartbeat();
    }
    expect(env.core.timer.elapsedSeconds()).toBe(26 * 3600);
  });

  it('timestamps are stored in UTC regardless of process timezone', async () => {
    const { env, ctx } = await setup();
    await env.core.timer.start(ctx);
    env.clock.advance(H);
    await env.core.timer.stop();
    const e = env.core.index.all('time_entry')[0]!;
    expect(e.started_at.endsWith('Z')).toBe(true);
    expect(e.ended_at.endsWith('Z')).toBe(true);
  });

  it('session spanning a DST change counts real elapsed time', async () => {
    // 2026-10-25 03:00 CEST → 02:00 CET in Europe/Berlin. UTC math is unaffected.
    const env = await makeEnv({
      clock: new (await import('../helpers/fixtures')).FakeClock('2026-10-25T00:30:00Z'),
    });
    const seed = await seedBasic(env);
    await env.core.timer.start({
      project_id: seed.project.id,
      ticket_id: null,
      customer_id: null,
      service_id: null,
      description: '',
      billable: true,
    });
    env.clock.advance(2 * H);
    await env.core.timer.stop();
    expect(env.core.index.all('time_entry')[0]!.duration_seconds).toBe(7200);
  });
});
