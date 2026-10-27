import {
  ENTITY_TYPES,
  SCHEMAS,
  type AnyEntity,
  type EntityMap,
  type EntityType,
} from '@/domain/schemas/entities';
import { parseNote } from '../markdown/frontmatter';
import { migrate } from '../migrations/migrations';
import { fnv1a } from '@/shared/utilities/hash';
import { msg } from '@/shared/i18n';

export interface IndexedEntity<T extends AnyEntity = AnyEntity> {
  entity: T;
  path: string;
  /** Content hash; null when indexed from Obsidian's metadata cache (content not read). */
  hash: string | null;
  /** True if the file uses an older schema version and was migrated in memory only. */
  migrated: boolean;
  /** Frontmatter keys not defined by the schema (preserved on write). */
  extra: Record<string, unknown>;
  body: string;
}

export type IssueKind =
  'parse' | 'schema' | 'duplicate_id' | 'broken_ref' | 'migration' | 'mismatch';

export interface DataIssue {
  severity: 'error' | 'warning';
  kind: IssueKind;
  path: string;
  id?: string;
  message: string;
}

export type IndexChange = {
  kind: 'upsert' | 'remove';
  path: string;
  id?: string;
  type?: EntityType;
};

/**
 * Derived, disposable in-memory index of all plugin entities. Markdown files stay authoritative;
 * the index can be rebuilt at any time from the files.
 */
export class EntityIndex {
  private byPath = new Map<string, IndexedEntity>();
  private pathsById = new Map<string, Set<string>>();
  private fileIssues = new Map<string, DataIssue[]>();
  private typeCache = new Map<EntityType, AnyEntity[]>();
  private refIssueCache: { version: number; issues: DataIssue[] } | null = null;
  private listeners = new Set<(changes: IndexChange[]) => void>();
  version = 0;

  clear(): void {
    this.byPath.clear();
    this.pathsById.clear();
    this.fileIssues.clear();
    this.bump([]);
  }

  subscribe(fn: (changes: IndexChange[]) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private bump(changes: IndexChange[]): void {
    this.version++;
    this.typeCache.clear();
    for (const l of this.listeners) l(changes);
  }

  /** Index a file's content. Returns false if the file is not a plugin entity. */
  upsert(path: string, content: string, notify = true): boolean {
    const hash = fnv1a(content);
    const existing = this.byPath.get(path);
    if (existing && existing.hash === hash) return true;
    const parsed = parseNote(content);
    if (parsed.error) {
      this.removeInternal(path);
      this.fileIssues.set(path, [
        { severity: 'error', kind: 'parse', path, message: parsed.error },
      ]);
      if (notify) this.bump([{ kind: 'upsert', path }]);
      return true;
    }
    return this.upsertData(path, parsed.data, parsed.body, hash, notify);
  }

  /**
   * Index already-parsed frontmatter (e.g. from Obsidian's metadata cache, which avoids
   * re-parsing YAML at startup). `hash` may be null if the raw content was not read.
   */
  upsertData(
    path: string,
    data: Record<string, unknown> | null,
    body: string,
    hash: string | null,
    notify = true,
  ): boolean {
    const existing = this.byPath.get(path);
    this.removeInternal(path);
    const type = data?.['type'];
    if (!data || typeof type !== 'string' || !(ENTITY_TYPES as string[]).includes(type)) {
      if (existing && notify) this.bump([{ kind: 'remove', path, id: existing.entity.id }]);
      return false;
    }
    const t = type as EntityType;
    const mig = migrate(t, data);
    if (mig.error) {
      this.fileIssues.set(path, [
        {
          severity: 'error',
          kind: 'migration',
          path,
          id: String(data['id'] ?? ''),
          message: mig.error,
        },
      ]);
      if (notify) this.bump([{ kind: 'upsert', path }]);
      return true;
    }
    const result = SCHEMAS[t].safeParse(mig.data);
    if (!result.success) {
      const msg = result.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      this.fileIssues.set(path, [
        { severity: 'error', kind: 'schema', path, id: String(data['id'] ?? ''), message: msg },
      ]);
      if (notify) this.bump([{ kind: 'upsert', path }]);
      return true;
    }
    const entity = result.data as AnyEntity;
    const known = new Set(Object.keys(result.data));
    const extra: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) if (!known.has(k)) extra[k] = v;
    this.byPath.set(path, { entity, path, hash, migrated: mig.migrated, extra, body });
    const set = this.pathsById.get(entity.id) ?? new Set<string>();
    set.add(path);
    this.pathsById.set(entity.id, set);
    if (mig.migrated) {
      this.fileIssues.set(path, [
        {
          severity: 'warning',
          kind: 'migration',
          path,
          id: entity.id,
          message: msg(
            `Schema v${mig.from} → v${mig.to} (nur im Speicher migriert)`,
            `Schema v${mig.from} → v${mig.to} (migrated in memory only)`,
          ),
        },
      ]);
    }
    if (notify) this.bump([{ kind: 'upsert', path, id: entity.id, type: t }]);
    return true;
  }

  private removeInternal(path: string): IndexedEntity | undefined {
    const rec = this.byPath.get(path);
    this.fileIssues.delete(path);
    if (!rec) return undefined;
    this.byPath.delete(path);
    const set = this.pathsById.get(rec.entity.id);
    set?.delete(path);
    if (set && set.size === 0) this.pathsById.delete(rec.entity.id);
    return rec;
  }

  remove(path: string): void {
    const hadIssues = this.fileIssues.has(path);
    const rec = this.removeInternal(path);
    if (rec || hadIssues)
      this.bump([{ kind: 'remove', path, id: rec?.entity.id, type: rec?.entity.type }]);
  }

  rename(from: string, to: string, content: string): void {
    this.removeInternal(from);
    this.upsert(to, content, false);
    this.bump([{ kind: 'upsert', path: to }]);
  }

  /** Bulk load without per-file notifications. */
  load(files: { path: string; content: string }[]): void {
    for (const f of files) this.upsert(f.path, f.content, false);
    this.bump([]);
  }

  /** Primary record for an ID (first path in sort order if duplicates exist). */
  record(id: string): IndexedEntity | undefined {
    const paths = this.pathsById.get(id);
    if (!paths || paths.size === 0) return undefined;
    const primary = paths.size === 1 ? paths.values().next().value! : [...paths].sort()[0]!;
    return this.byPath.get(primary);
  }

  recordAt(path: string): IndexedEntity | undefined {
    return this.byPath.get(path);
  }

  get<T extends EntityType>(type: T, id: string | null | undefined): EntityMap[T] | undefined {
    if (!id) return undefined;
    const r = this.record(id);
    return r && r.entity.type === type ? (r.entity as EntityMap[T]) : undefined;
  }

  pathOf(id: string): string | undefined {
    return this.record(id)?.path;
  }

  all<T extends EntityType>(type: T): EntityMap[T][] {
    let cached = this.typeCache.get(type);
    if (!cached) {
      cached = [];
      for (const [id, paths] of this.pathsById) {
        const rec = this.record(id);
        if (rec && rec.entity.type === type && paths.size > 0) cached.push(rec.entity);
      }
      this.typeCache.set(type, cached);
    }
    return cached as EntityMap[T][];
  }

  get size(): number {
    return this.byPath.size;
  }

  hasId(id: string): boolean {
    return (this.pathsById.get(id)?.size ?? 0) > 0;
  }

  issues(): DataIssue[] {
    const out: DataIssue[] = [];
    for (const list of this.fileIssues.values()) out.push(...list);
    for (const [id, paths] of this.pathsById) {
      if (paths.size > 1) {
        const sorted = [...paths].sort();
        for (const p of sorted.slice(1)) {
          out.push({
            severity: 'error',
            kind: 'duplicate_id',
            path: p,
            id,
            message: msg(
              `Doppelte ID ${id} (Original: ${sorted[0]}). Datei wird ignoriert.`,
              `Duplicate ID ${id} (original: ${sorted[0]}). File is ignored.`,
            ),
          });
        }
      }
    }
    out.push(...this.referenceIssues());
    return out;
  }

  /** Referential integrity checks (cached per index version). */
  referenceIssues(): DataIssue[] {
    if (this.refIssueCache?.version === this.version) return this.refIssueCache.issues;
    const issues: DataIssue[] = [];
    const ref = (src: AnyEntity, field: string, id: string | null, type: EntityType) => {
      if (!id) return;
      const target = this.record(id);
      if (!target || target.entity.type !== type) {
        issues.push({
          severity: 'error',
          kind: 'broken_ref',
          path: this.pathOf(src.id) ?? '',
          id: src.id,
          message: msg(
            `${field} verweist auf fehlende(s) ${type}: ${id}`,
            `${field} refers to missing ${type}: ${id}`,
          ),
        });
      }
    };
    for (const c of this.all('contact')) ref(c, 'customer_id', c.customer_id, 'customer');
    for (const i of this.all('interaction')) {
      ref(i, 'customer_id', i.customer_id, 'customer');
      ref(i, 'project_id', i.project_id, 'project');
    }
    for (const p of this.all('project')) {
      ref(p, 'customer_id', p.customer_id, 'customer');
      ref(p, 'service_id', p.service_id, 'service');
    }
    for (const t of this.all('ticket')) {
      ref(t, 'project_id', t.project_id, 'project');
      ref(t, 'parent_id', t.parent_id, 'ticket');
      for (const d of t.depends_on) ref(t, 'depends_on', d, 'ticket');
      const p = this.get('project', t.project_id);
      if (p && t.customer_id && p.customer_id !== t.customer_id) {
        issues.push({
          severity: 'warning',
          kind: 'mismatch',
          path: this.pathOf(t.id) ?? '',
          id: t.id,
          message: msg(
            `customer_id passt nicht zum Projekt (${p.customer_id ?? 'intern'})`,
            `customer_id does not match the project (${p.customer_id ?? 'internal'})`,
          ),
        });
      }
    }
    for (const e of this.all('time_entry')) {
      ref(e, 'project_id', e.project_id, 'project');
      ref(e, 'ticket_id', e.ticket_id, 'ticket');
      ref(e, 'customer_id', e.customer_id, 'customer');
      ref(e, 'billing_batch_id', e.billing_batch_id, 'billing_batch');
      ref(e, 'adjusts_entry_id', e.adjusts_entry_id, 'time_entry');
      if (e.ticket_id) {
        const t = this.get('ticket', e.ticket_id);
        if (t && t.project_id !== e.project_id) {
          issues.push({
            severity: 'warning',
            kind: 'mismatch',
            path: this.pathOf(e.id) ?? '',
            id: e.id,
            message: msg(
              'Ticket gehört zu einem anderen Projekt',
              'Ticket belongs to a different project',
            ),
          });
        }
      }
      if (
        (e.billing_status === 'reserved' || e.billing_status === 'invoiced') &&
        !e.billing_batch_id
      ) {
        issues.push({
          severity: 'error',
          kind: 'mismatch',
          path: this.pathOf(e.id) ?? '',
          id: e.id,
          message: msg(
            `Status ${e.billing_status} ohne Abrechnungslauf`,
            `Status ${e.billing_status} without billing batch`,
          ),
        });
      }
    }
    for (const b of this.all('billing_batch')) {
      for (const id of b.entry_ids) {
        ref(b, 'entry_ids', id, 'time_entry');
        const e = this.get('time_entry', id);
        if (e && b.status !== 'cancelled' && e.billing_batch_id !== b.id) {
          issues.push({
            severity: 'error',
            kind: 'mismatch',
            path: this.pathOf(b.id) ?? '',
            id: b.id,
            message: msg(
              `Zeiteintrag ${id} verweist nicht auf diesen Abrechnungslauf (unvollständige Operation?)`,
              `Time entry ${id} does not refer to this billing batch (incomplete operation?)`,
            ),
          });
        }
      }
      for (const id of b.expense_ids) ref(b, 'expense_ids', id, 'expense');
    }
    for (const q of this.all('quote')) {
      ref(q, 'customer_id', q.customer_id, 'customer');
      ref(q, 'project_id', q.project_id, 'project');
    }
    for (const x of this.all('expense')) {
      ref(x, 'customer_id', x.customer_id, 'customer');
      ref(x, 'project_id', x.project_id, 'project');
    }
    for (const r of this.all('recurring_task')) {
      ref(r, 'project_id', r.project_id, 'project');
      ref(r, 'service_id', r.service_id, 'service');
    }
    this.refIssueCache = { version: this.version, issues };
    return issues;
  }
}
