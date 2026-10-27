import { derivedId, newId } from '@/shared/ids/entity-ids';
import type { Clock } from '@/shared/date/time';
import { toIso } from '@/shared/date/time';
import { DomainError } from '../errors/errors';
import { Mutex } from '@/shared/utilities/mutex';
import { msg } from '@/shared/i18n';

/**
 * Timer engine.
 *
 * Invariants
 *  - Elapsed time is always derived from persisted segment timestamps, never from a counter.
 *  - At most one session exists at a time (repeated start is rejected).
 *  - Every session maps to at most one time entry; the entry ID is derived from the session ID
 *    and therefore known before anything is written (idempotent commit).
 *  - Commit protocol: (1) persist session as "stopping" with the final payload,
 *    (2) create entry if absent, (3) clear session. A crash between any two steps is
 *    resumed on next load without producing duplicates.
 *  - Offline periods (crash, reboot, suspend, forward clock jumps) are never counted
 *    automatically; the session goes to RECOVERING and the user decides.
 */

export type TimerStateName = 'idle' | 'running' | 'paused' | 'recovering' | 'stopping';

export interface TimerSegment {
  start: number;
  end: number | null;
}

export interface TimerGap {
  from: number;
  to: number;
  reason: 'stale_heartbeat' | 'suspend_or_clock_jump';
}

export interface TimerContext {
  project_id: string | null;
  ticket_id: string | null;
  customer_id: string | null;
  service_id: string | null;
  description: string;
  billable: boolean;
}

export interface TimerSession extends TimerContext {
  session_id: string;
  entry_id: string;
  state: Exclude<TimerStateName, 'idle'>;
  /** state to return to after recovery (running|paused) */
  state_before_recovery: 'running' | 'paused' | null;
  segments: TimerSegment[];
  created_at: number;
  last_heartbeat_at: number;
  gap: TimerGap | null;
  notes: string[];
  recovered: boolean;
  /** Final payload while committing. */
  pending_entry: Record<string, unknown> | null;
}

export interface CommittedRecord {
  session_id: string;
  entry_id: string;
  at: number;
}

export interface TimerPersistedState {
  version: 1;
  session: TimerSession | null;
  committed: CommittedRecord[];
}

export interface TimerStore {
  load(): Promise<TimerPersistedState | null>;
  save(state: TimerPersistedState): Promise<void>;
}

export interface TimerEntrySink {
  /** Create the entry if (and only if) no entry with this ID exists. Must be idempotent. */
  createIfAbsent(entry: Record<string, unknown>): Promise<'created' | 'exists'>;
  exists(entryId: string): Promise<boolean>;
}

export interface TimerEntryFactory {
  /** Build a full time entry payload (rate snapshot etc.) for a finished session. */
  build(
    session: TimerSession,
    segments: { start: number; end: number }[],
    durationSeconds: number,
  ): Promise<Record<string, unknown>>;
}

export interface TimerOptions {
  heartbeatMs: number;
  /** A heartbeat older than this on load means the app was not running → RECOVERING. */
  staleAfterMs: number;
  /** Allowed difference between wall-clock and monotonic deltas before we assume suspend/clock jump. */
  clockToleranceMs: number;
  minEntrySeconds: number;
}

export const DEFAULT_TIMER_OPTIONS: TimerOptions = {
  heartbeatMs: 15_000,
  staleAfterMs: 120_000,
  clockToleranceMs: 30_000,
  minEntrySeconds: 60,
};

export type StopResult =
  | { kind: 'committed'; entryId: string; durationSeconds: number }
  | { kind: 'too_short'; durationSeconds: number }
  | { kind: 'nothing_to_stop'; lastEntryId: string | null };

export type RecoveryResolution =
  | { kind: 'exclude_gap'; then: 'resume' | 'pause' | 'stop' }
  | { kind: 'include_gap'; then: 'resume' | 'stop' }
  | { kind: 'end_at'; at: number }
  | { kind: 'discard' };

export class TimerError extends DomainError {}

const MAX_COMMITTED = 100;

export function sessionElapsedSeconds(
  session: Pick<TimerSession, 'segments'>,
  nowMs: number,
): number {
  let ms = 0;
  for (const s of session.segments) {
    const end = s.end ?? nowMs;
    ms += Math.max(0, end - s.start);
  }
  return Math.floor(ms / 1000);
}

export function timerStateName(session: TimerSession | null): TimerStateName {
  return session ? session.state : 'idle';
}

export class TimerEngine {
  private state: TimerPersistedState = { version: 1, session: null, committed: [] };
  private readonly mutex = new Mutex();
  private listeners = new Set<(s: TimerSession | null) => void>();
  private lastWall = 0;
  private lastMono = 0;
  private loaded = false;

  constructor(
    private readonly store: TimerStore,
    private readonly sink: TimerEntrySink,
    private readonly factory: TimerEntryFactory,
    private readonly clock: Clock,
    private readonly options: TimerOptions = DEFAULT_TIMER_OPTIONS,
  ) {}

  get session(): TimerSession | null {
    return this.state.session;
  }

  get stateName(): TimerStateName {
    return timerStateName(this.state.session);
  }

  get lastCommitted(): CommittedRecord | null {
    return this.state.committed[this.state.committed.length - 1] ?? null;
  }

  elapsedSeconds(): number {
    return this.state.session ? sessionElapsedSeconds(this.state.session, this.clock.now()) : 0;
  }

  subscribe(fn: (s: TimerSession | null) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    const snapshot = this.state.session ? structuredClone(this.state.session) : null;
    for (const l of this.listeners) l(snapshot);
  }

  private async persist(): Promise<void> {
    await this.store.save(structuredClone(this.state));
  }

  /** Load persisted state; detects crashes / stale sessions and finishes interrupted commits. */
  async load(): Promise<void> {
    await this.mutex.run(async () => {
      const loaded = await this.store.load();
      this.state = loaded ?? { version: 1, session: null, committed: [] };
      this.loaded = true;
      const s = this.state.session;
      const now = this.clock.now();
      if (s?.state === 'stopping') {
        await this.finishCommit();
      } else if (s?.state === 'running') {
        const open = s.segments.find((x) => x.end === null);
        if (now - s.last_heartbeat_at > this.options.staleAfterMs || now < s.last_heartbeat_at) {
          // App was not running (crash, quit, reboot) or clock went backwards: close at last known alive time.
          const closeAt = Math.max(open?.start ?? s.last_heartbeat_at, s.last_heartbeat_at);
          if (open) open.end = closeAt;
          s.state_before_recovery = 'running';
          s.state = 'recovering';
          s.gap = { from: closeAt, to: Math.max(now, closeAt), reason: 'stale_heartbeat' };
          s.notes.push(
            msg(
              `${toIso(now)} Wiederherstellung: letzte Aktivität ${toIso(closeAt)}`,
              `${toIso(now)} Recovery: last activity ${toIso(closeAt)}`,
            ),
          );
          await this.persist();
        } else {
          s.last_heartbeat_at = now;
          await this.persist();
        }
      }
      this.lastWall = now;
      this.lastMono = this.clock.monotonic();
    });
    this.emit();
  }

  private requireLoaded(): void {
    if (!this.loaded)
      throw new TimerError(
        'timer_not_loaded',
        msg('Timer ist noch nicht initialisiert', 'Timer is not initialised yet'),
      );
  }

  async start(ctx: TimerContext): Promise<TimerSession> {
    const result = await this.mutex.run(async () => {
      this.requireLoaded();
      if (this.state.session) {
        throw new TimerError(
          'timer_already_active',
          msg(
            'Es läuft bereits ein Timer. Bitte zuerst stoppen.',
            'A timer is already running. Please stop it first.',
          ),
        );
      }
      if (!ctx.project_id)
        throw new TimerError(
          'timer_no_project',
          msg('Für den Timer ist ein Projekt erforderlich.', 'The timer requires a project.'),
        );
      const now = this.clock.now();
      const sessionId = newId('timer_session');
      const session: TimerSession = {
        ...ctx,
        session_id: sessionId,
        entry_id: derivedId('time_entry', sessionId),
        state: 'running',
        state_before_recovery: null,
        segments: [{ start: now, end: null }],
        created_at: now,
        last_heartbeat_at: now,
        gap: null,
        notes: [],
        recovered: false,
        pending_entry: null,
      };
      this.state.session = session;
      await this.persist();
      this.lastWall = now;
      this.lastMono = this.clock.monotonic();
      return structuredClone(session);
    });
    this.emit();
    return result;
  }

  async pause(): Promise<void> {
    await this.mutex.run(async () => {
      const s = this.state.session;
      if (!s || s.state !== 'running') return;
      const now = this.clock.now();
      const open = s.segments.find((x) => x.end === null);
      if (open) open.end = Math.max(now, open.start);
      s.state = 'paused';
      s.last_heartbeat_at = now;
      await this.persist();
    });
    this.emit();
  }

  async resume(): Promise<void> {
    await this.mutex.run(async () => {
      const s = this.state.session;
      if (!s || s.state !== 'paused') return;
      const now = this.clock.now();
      const last = s.segments[s.segments.length - 1];
      s.segments.push({ start: Math.max(now, last?.end ?? now), end: null });
      s.state = 'running';
      s.last_heartbeat_at = now;
      await this.persist();
      this.lastWall = now;
      this.lastMono = this.clock.monotonic();
    });
    this.emit();
  }

  async update(patch: Partial<TimerContext>): Promise<void> {
    await this.mutex.run(async () => {
      const s = this.state.session;
      if (!s || s.state === 'stopping') return;
      if (patch.project_id === null)
        throw new TimerError(
          'timer_no_project',
          msg('Für den Timer ist ein Projekt erforderlich.', 'The timer requires a project.'),
        );
      Object.assign(s, patch);
      await this.persist();
    });
    this.emit();
  }

  /**
   * Periodic heartbeat. Persists liveness and detects suspend / clock jumps by comparing the
   * wall-clock delta with the monotonic delta since the previous tick.
   */
  async heartbeat(): Promise<void> {
    let changed = false;
    await this.mutex.run(async () => {
      const s = this.state.session;
      const now = this.clock.now();
      const mono = this.clock.monotonic();
      const wallDelta = now - this.lastWall;
      const monoDelta = mono - this.lastMono;
      const prevWall = this.lastWall;
      this.lastWall = now;
      this.lastMono = mono;
      if (!s || s.state !== 'running') return;
      const open = s.segments.find((x) => x.end === null);
      const drift = wallDelta - monoDelta;
      if (open && drift < -this.options.clockToleranceMs) {
        // Wall clock moved backwards: the monotonic clock tells us how much real time passed.
        open.end = Math.max(open.start, prevWall + monoDelta);
        s.segments.push({ start: now, end: null });
        s.notes.push(
          msg(
            `${toIso(now)} Systemuhr wurde zurückgestellt (${Math.round(-drift / 1000)} s) – Segment neu begonnen`,
            `${toIso(now)} System clock was set back (${Math.round(-drift / 1000)} s) – new segment started`,
          ),
        );
        changed = true;
      } else if (open && drift > this.options.clockToleranceMs) {
        // Suspend/hibernate or forward clock jump: real awake time ends at prevWall + monoDelta.
        const awakeEnd = Math.max(open.start, prevWall + monoDelta);
        open.end = awakeEnd;
        s.state_before_recovery = 'running';
        s.state = 'recovering';
        s.gap = { from: awakeEnd, to: now, reason: 'suspend_or_clock_jump' };
        s.notes.push(
          msg(
            `${toIso(now)} Unterbrechung erkannt (${Math.round(drift / 1000)} s)`,
            `${toIso(now)} Interruption detected (${Math.round(drift / 1000)} s)`,
          ),
        );
        changed = true;
      }
      s.last_heartbeat_at = now;
      await this.persist();
    });
    if (changed) this.emit();
  }

  async recover(resolution: RecoveryResolution): Promise<StopResult | null> {
    let thenStop = false;
    let discard = false;
    await this.mutex.run(async () => {
      const s = this.state.session;
      if (!s || s.state !== 'recovering' || !s.gap)
        throw new TimerError(
          'timer_not_recovering',
          msg('Keine Wiederherstellung ausstehend', 'No recovery pending'),
        );
      const now = this.clock.now();
      const gap = s.gap;
      s.recovered = true;
      switch (resolution.kind) {
        case 'discard':
          discard = true;
          return;
        case 'exclude_gap':
          s.notes.push(
            msg(
              `${toIso(now)} Unterbrechung nicht gezählt`,
              `${toIso(now)} Interruption not counted`,
            ),
          );
          if (resolution.then === 'resume') {
            s.segments.push({ start: now, end: null });
            s.state = 'running';
          } else {
            s.state = 'paused';
            thenStop = resolution.then === 'stop';
          }
          break;
        case 'include_gap': {
          s.notes.push(
            msg(
              `${toIso(now)} Unterbrechung als Arbeitszeit bestätigt`,
              `${toIso(now)} Interruption confirmed as working time`,
            ),
          );
          const last = s.segments[s.segments.length - 1];
          if (last && last.end === gap.from) last.end = null;
          else s.segments.push({ start: gap.from, end: null });
          if (resolution.then === 'resume') {
            s.state = 'running';
          } else {
            const open = s.segments.find((x) => x.end === null)!;
            open.end = now;
            s.state = 'paused';
            thenStop = true;
          }
          break;
        }
        case 'end_at': {
          const at = resolution.at;
          if (at < gap.from || at > Math.max(now, gap.to)) {
            throw new TimerError(
              'timer_bad_end',
              msg(
                'Das Ende muss zwischen letzter Aktivität und jetzt liegen',
                'The end must be between the last activity and now',
              ),
            );
          }
          s.notes.push(
            msg(
              `${toIso(now)} Arbeitsende manuell auf ${toIso(at)} gesetzt`,
              `${toIso(now)} End of work set manually to ${toIso(at)}`,
            ),
          );
          const last = s.segments[s.segments.length - 1];
          if (last && last.end === gap.from) last.end = at;
          else if (at > gap.from) s.segments.push({ start: gap.from, end: at });
          s.state = 'paused';
          thenStop = true;
          break;
        }
      }
      s.gap = null;
      s.state_before_recovery = null;
      s.last_heartbeat_at = now;
      this.lastWall = now;
      this.lastMono = this.clock.monotonic();
      await this.persist();
    });
    if (discard) {
      await this.discard();
      return null;
    }
    this.emit();
    if (thenStop) return this.stop({ allowShort: true });
    return null;
  }

  /** Idempotent stop. A repeated call after commit returns `nothing_to_stop` with the last entry id. */
  async stop(opts: { allowShort?: boolean } = {}): Promise<StopResult> {
    const result = await this.mutex.run(async (): Promise<StopResult> => {
      const s = this.state.session;
      if (!s) return { kind: 'nothing_to_stop', lastEntryId: this.lastCommitted?.entry_id ?? null };
      if (s.state === 'recovering')
        throw new TimerError(
          'timer_recovering',
          msg(
            'Bitte zuerst die Wiederherstellung abschließen.',
            'Please finish the recovery first.',
          ),
        );
      if (s.state !== 'stopping') {
        const now = this.clock.now();
        const closed = s.segments.map((seg) => ({
          start: seg.start,
          end: seg.end ?? Math.max(now, seg.start),
        }));
        const duration = sessionElapsedSeconds({ segments: closed }, now);
        if (!opts.allowShort && duration < this.options.minEntrySeconds) {
          return { kind: 'too_short', durationSeconds: duration };
        }
        const nonEmpty = closed.filter((x) => x.end > x.start);
        const payload = await this.factory.build(
          s,
          nonEmpty.length ? nonEmpty : closed.slice(0, 1),
          duration,
        );
        s.segments = closed;
        s.pending_entry = payload;
        s.state = 'stopping';
        await this.persist(); // step 1
      }
      return this.finishCommit();
    });
    this.emit();
    return result;
  }

  private async finishCommit(): Promise<StopResult> {
    const s = this.state.session;
    if (!s || s.state !== 'stopping' || !s.pending_entry) {
      return { kind: 'nothing_to_stop', lastEntryId: this.lastCommitted?.entry_id ?? null };
    }
    await this.sink.createIfAbsent(s.pending_entry); // step 2 (idempotent)
    const duration = Number(s.pending_entry['duration_seconds'] ?? 0);
    this.state.committed.push({
      session_id: s.session_id,
      entry_id: s.entry_id,
      at: this.clock.now(),
    });
    if (this.state.committed.length > MAX_COMMITTED)
      this.state.committed.splice(0, this.state.committed.length - MAX_COMMITTED);
    this.state.session = null;
    await this.persist(); // step 3
    return { kind: 'committed', entryId: s.entry_id, durationSeconds: duration };
  }

  /** Discard the running session without writing an entry. The UI must confirm before calling this. */
  async discard(): Promise<void> {
    await this.mutex.run(async () => {
      const s = this.state.session;
      if (!s) return;
      if (s.state === 'stopping')
        throw new TimerError(
          'timer_committing',
          msg('Der Eintrag wird gerade gespeichert.', 'The entry is being saved.'),
        );
      this.state.session = null;
      await this.persist();
    });
    this.emit();
  }
}
