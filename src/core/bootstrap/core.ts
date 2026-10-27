import type { LytexSettings } from '../configuration/settings';
import { FOLDERS } from '../configuration/settings';
import type { Clock } from '@/shared/date/time';
import { EntityIndex } from '@/infrastructure/indexing/entity-index';
import type { FileStore, RawStore } from '@/infrastructure/persistence/file-store';
import { joinPath } from '@/infrastructure/persistence/file-store';
import { WriteJournal, type RecoveryReport } from '@/infrastructure/persistence/journal';
import { PathPolicy } from '@/infrastructure/persistence/paths';
import { Repository } from '@/infrastructure/persistence/repository';
import { parseNote } from '@/infrastructure/markdown/frontmatter';
import { TimerEngine, DEFAULT_TIMER_OPTIONS } from '@/domain/services/timer';
import { DurableTimerStore, RepositoryEntrySink } from '@/infrastructure/timer/timer-adapters';
import { timerEntryFactory } from '@/application/use-cases/time';
import type { AppContext } from '@/application/context';
import { reconcileRecurring, type ReconcileReport } from '@/application/use-cases/recurring';
import { expireQuotes } from '@/application/use-cases/finance';

export interface StartupReport {
  files: number;
  entities: number;
  ms: number;
  recovery: RecoveryReport;
  recurring: ReconcileReport | null;
  expiredQuotes: number;
}

/**
 * Composition root without any Obsidian dependency. The plugin passes Obsidian-backed stores;
 * tests pass in-memory stores. Everything above this layer only sees `AppContext`.
 */
export class OpsCore {
  readonly index = new EntityIndex();
  readonly journal: WriteJournal;
  readonly paths: PathPolicy;
  readonly repo: Repository;
  readonly timer: TimerEngine;
  readonly ctx: AppContext;
  ready = false;

  constructor(
    readonly files: FileStore,
    readonly raw: RawStore,
    private readonly getSettings: () => LytexSettings,
    readonly clock: Clock,
  ) {
    this.journal = new WriteJournal(files, raw);
    this.paths = new PathPolicy(() => this.getSettings().rootFolder, this.index);
    this.repo = new Repository(files, this.index, this.journal, this.paths, clock);
    this.ctx = {
      repo: this.repo,
      index: this.index,
      files,
      paths: this.paths,
      clock,
      settings: getSettings,
    };
    const s = getSettings();
    this.timer = new TimerEngine(
      new DurableTimerStore(raw),
      new RepositoryEntrySink(this.repo),
      timerEntryFactory(this.ctx),
      clock,
      {
        ...DEFAULT_TIMER_OPTIONS,
        heartbeatMs: s.timer.heartbeatSeconds * 1000,
        staleAfterMs: s.timer.staleAfterMinutes * 60_000,
        minEntrySeconds: s.timer.minEntrySeconds,
      },
    );
  }

  get root(): string {
    return this.getSettings().rootFolder;
  }

  /**
   * Full index rebuild from the Markdown files (the files are the source of truth).
   * `frontmatter` may supply already-parsed frontmatter (Obsidian metadata cache) to avoid
   * re-parsing YAML; files without cached frontmatter are read and parsed.
   */
  async rebuildIndex(
    read: (path: string) => Promise<string | null> = (p) => this.files.read(p),
    frontmatter?: (path: string) => Record<string, unknown> | undefined,
  ): Promise<number> {
    const paths = await this.files.listMarkdown(this.root);
    const loaded: { path: string; content: string }[] = [];
    const cached: { path: string; data: Record<string, unknown> }[] = [];
    const toRead: string[] = [];
    for (const p of paths) {
      const fm = frontmatter?.(p);
      if (fm) cached.push({ path: p, data: fm });
      else toRead.push(p);
    }
    const batch = 200;
    for (let i = 0; i < toRead.length; i += batch) {
      const chunk = toRead.slice(i, i + batch);
      const contents = await Promise.all(chunk.map((p) => read(p)));
      chunk.forEach((p, j) => {
        const c = contents[j];
        if (c !== null && c !== undefined) loaded.push({ path: p, content: c });
      });
    }
    this.index.clear();
    for (const c of cached) this.index.upsertData(c.path, c.data, '', null, false);
    this.index.load(loaded);
    return paths.length;
  }

  async start(
    opts: {
      reconcile?: boolean;
      read?: (path: string) => Promise<string | null>;
      frontmatter?: (path: string) => Record<string, unknown> | undefined;
    } = {},
  ): Promise<StartupReport> {
    const t0 = Date.now();
    await this.journal.init();
    // Recover interrupted writes before building the index so that the index sees the final state.
    const recovery = await this.journal.recover((content) => {
      const p = parseNote(content);
      return p.hasFrontmatter && p.error !== null;
    });
    const files = await this.rebuildIndex(opts.read, opts.frontmatter);
    await this.timer.load();
    let recurring: ReconcileReport | null = null;
    let expiredQuotes = 0;
    if (opts.reconcile !== false) {
      recurring = await reconcileRecurring(this.ctx);
      expiredQuotes = await expireQuotes(this.ctx);
    }
    this.ready = true;
    return {
      files,
      entities: this.index.size,
      ms: Date.now() - t0,
      recovery,
      recurring,
      expiredQuotes,
    };
  }

  /** Create the folder skeleton (only folders + generated overview notes inside the root). */
  async ensureStructure(): Promise<void> {
    for (const f of Object.values(FOLDERS)) await this.files.ensureFolder(joinPath(this.root, f));
  }

  isInRoot(path: string): boolean {
    return path === this.root || path.startsWith(`${this.root}/`);
  }
}
