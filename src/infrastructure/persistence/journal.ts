import type { FileStore, RawStore } from './file-store';
import { DurableJson } from './durable-json';
import { fnv1a } from '@/shared/utilities/hash';
import { newId } from '@/shared/ids/entity-ids';
import { msg } from '@/shared/i18n';

export interface JournalWrite {
  path: string;
  /** Full intended content after the operation. */
  content: string;
  /** Hash of the content before the operation (null = file must not exist). */
  before: string | null;
}

export interface JournalOp {
  id: string;
  label: string;
  at: string;
  writes: JournalWrite[];
}

export interface RecoveryReport {
  replayed: number;
  alreadyApplied: number;
  conflicts: { op: string; path: string; savedAs: string }[];
}

/**
 * Write-ahead journal for (multi-)file operations.
 *
 * Markdown files offer no transactions. Every logical operation is first recorded in the journal
 * with the complete target content of every affected file; then the files are written; then the
 * op is removed from the journal. On startup, pending ops are rolled forward:
 *  - file already has the target content → nothing to do
 *  - file still has the "before" content (or is missing/truncated) → write the target content
 *  - file was changed by someone else meanwhile → do NOT overwrite; keep the intended content
 *    as a conflict copy in plugin storage and report it.
 */
export class WriteJournal {
  private readonly log: DurableJson<JournalOp[]>;
  private pending: JournalOp[] = [];

  constructor(
    private readonly files: FileStore,
    private readonly raw: RawStore,
  ) {
    this.log = new DurableJson<JournalOp[]>(raw, 'journal');
  }

  async init(): Promise<JournalOp[]> {
    this.pending = (await this.log.load()) ?? [];
    return [...this.pending];
  }

  async run(label: string, writes: JournalWrite[]): Promise<void> {
    const op: JournalOp = { id: newId('operation'), label, at: new Date().toISOString(), writes };
    this.pending.push(op);
    await this.log.save(this.pending);
    for (const w of writes) {
      if (w.before === null && !(await this.files.exists(w.path)))
        await this.files.create(w.path, w.content);
      else await this.files.write(w.path, w.content);
    }
    this.pending = this.pending.filter((p) => p.id !== op.id);
    await this.log.save(this.pending);
  }

  async recover(isTruncatedOrCorrupt: (content: string) => boolean): Promise<RecoveryReport> {
    const report: RecoveryReport = { replayed: 0, alreadyApplied: 0, conflicts: [] };
    for (const op of [...this.pending]) {
      for (const w of op.writes) {
        const current = await this.files.read(w.path);
        const target = fnv1a(w.content);
        if (current !== null && fnv1a(current) === target) {
          report.alreadyApplied++;
          continue;
        }
        const untouched =
          current === null ? true : fnv1a(current) === w.before || isTruncatedOrCorrupt(current);
        if (untouched) {
          await this.files.write(w.path, w.content);
          report.replayed++;
        } else {
          const savedAs = `conflicts/${op.id}-${fnv1a(w.path)}.md`;
          await this.raw.write(
            savedAs,
            `<!-- ${msg('Konflikt bei Wiederherstellung', 'Conflict during recovery')}: ${w.path} (${op.label}) -->\n${w.content}`,
          );
          report.conflicts.push({ op: op.id, path: w.path, savedAs });
        }
      }
      this.pending = this.pending.filter((p) => p.id !== op.id);
      await this.log.save(this.pending);
    }
    return report;
  }

  get pendingCount(): number {
    return this.pending.length;
  }
}

export const hashContent = fnv1a;
