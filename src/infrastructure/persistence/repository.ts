import {
  SCHEMAS,
  SCHEMA_VERSION,
  type AnyEntity,
  type EntityMap,
  type EntityType,
} from '@/domain/schemas/entities';
import { ConflictError, NotFoundError, ValidationError } from '@/domain/errors/errors';
import { newId } from '@/shared/ids/entity-ids';
import { toIso, type Clock } from '@/shared/date/time';
import { KeyedMutex } from '@/shared/utilities/mutex';
import { parseNote, serializeNote } from '../markdown/frontmatter';
import { initialBody } from '../markdown/bodies';
import type { EntityIndex } from '../indexing/entity-index';
import type { FileStore } from './file-store';
import { dirname } from './file-store';
import { hashContent, type JournalWrite, type WriteJournal } from './journal';
import type { PathPolicy } from './paths';
import { msg } from '@/shared/i18n';

const ID_KIND: Record<EntityType, Parameters<typeof newId>[0]> = {
  customer: 'customer',
  contact: 'contact',
  interaction: 'interaction',
  project: 'project',
  ticket: 'ticket',
  time_entry: 'time_entry',
  billing_batch: 'billing_batch',
  quote: 'quote',
  expense: 'expense',
  recurring_task: 'recurring_task',
  service: 'service',
};

/** Input for creating an entity: all type-specific fields, base fields are generated. */
export type CreateInput<T extends EntityType> = Omit<
  EntityMap[T],
  'id' | 'type' | 'schema_version' | 'created_at' | 'updated_at' | 'archived' | 'tags'
> & {
  id?: string;
  tags?: string[];
  archived?: boolean;
};

export interface UpdateOptions {
  /** Optimistic concurrency: the `updated_at` the caller based its edit on. */
  expectedUpdatedAt?: string;
  label?: string;
}

export type Mutation<T> = (draft: T) => void | T;

export interface PlannedWrite {
  entity: AnyEntity;
  path: string;
  content: string;
  before: string | null;
}

/**
 * Markdown-backed repository for all entity types.
 * - Validates every write with the Zod schema.
 * - Preserves the note body and unknown frontmatter keys.
 * - Serializes writes (one global queue; correctness over throughput).
 * - Detects concurrent external edits via `updated_at` + content hash.
 * - Uses the write-ahead journal for crash recovery, including multi-file operations.
 */
export class Repository {
  private readonly mutex = new KeyedMutex();

  constructor(
    private readonly files: FileStore,
    readonly index: EntityIndex,
    private readonly journal: WriteJournal,
    private readonly paths: PathPolicy,
    private readonly clock: Clock,
  ) {}

  get<T extends EntityType>(type: T, id: string): EntityMap[T] {
    const e = this.index.get(type, id);
    if (!e) throw new NotFoundError(type, id);
    return e;
  }

  find<T extends EntityType>(type: T, id: string | null | undefined): EntityMap[T] | undefined {
    return this.index.get(type, id);
  }

  list<T extends EntityType>(type: T): EntityMap[T][] {
    return this.index.all(type);
  }

  validate<T extends EntityType>(type: T, data: Record<string, unknown>): EntityMap[T] {
    const res = SCHEMAS[type].safeParse(data);
    if (!res.success) {
      const issues = res.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      throw new ValidationError(
        issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('\n'),
        issues,
      );
    }
    return res.data as EntityMap[T];
  }

  private build<T extends EntityType>(type: T, input: CreateInput<T>): EntityMap[T] {
    const now = toIso(this.clock.now());
    const { id, tags, archived, ...rest } = input as CreateInput<T> & Record<string, unknown>;
    // Base fields are always generated here and cannot be injected through the input.
    const {
      created_at: _c,
      updated_at: _u,
      schema_version: _v,
      type: _t,
      ...fields
    } = rest as Record<string, unknown>;
    return this.validate(type, {
      ...fields,
      type,
      schema_version: SCHEMA_VERSION[type],
      id: id ?? newId(ID_KIND[type]),
      created_at: now,
      updated_at: now,
      archived: archived ?? false,
      tags: tags ?? [],
    });
  }

  private serialize(entity: AnyEntity, extra: Record<string, unknown>, body: string): string {
    const { type, schema_version, id, ...rest } = entity as AnyEntity & Record<string, unknown>;
    return serializeNote({ type, schema_version, id, ...rest, ...extra }, body);
  }

  private async uniquePath(path: string, reserved: Set<string>): Promise<string> {
    if (!(await this.files.exists(path)) && !reserved.has(path)) return path;
    const base = path.replace(/\.md$/, '');
    for (let i = 2; i < 1000; i++) {
      const p = `${base} (${i}).md`;
      if (!(await this.files.exists(p)) && !reserved.has(p)) return p;
    }
    throw new Error(msg(`Kein freier Dateiname für ${path}`, `No free file name for ${path}`));
  }

  /** Plan a create without writing (for multi-file operations). */
  async planCreate<T extends EntityType>(
    type: T,
    input: CreateInput<T>,
    opts: { body?: string; description?: string; path?: string } = {},
    reserved = new Set<string>(),
  ): Promise<PlannedWrite> {
    const entity = this.build(type, input);
    if (this.index.hasId(entity.id))
      throw new ConflictError(
        msg(`ID existiert bereits: ${entity.id}`, `ID already exists: ${entity.id}`),
      );
    const deterministic = type === 'time_entry';
    const target = opts.path ?? this.paths.pathFor(entity);
    const path = deterministic ? target : await this.uniquePath(target, reserved);
    if (deterministic && (await this.files.exists(path)))
      throw new ConflictError(
        msg(`Datei existiert bereits: ${path}`, `File already exists: ${path}`),
      );
    reserved.add(path);
    const body = opts.body ?? initialBody(entity, this.index, opts.description);
    return { entity, path, content: this.serialize(entity, {}, body), before: null };
  }

  /** Plan an update of an existing entity: re-reads the file to detect external changes. */
  async planUpdate<T extends EntityType>(
    type: T,
    id: string,
    mutate: Mutation<EntityMap[T]>,
    opts: UpdateOptions = {},
  ): Promise<PlannedWrite> {
    const rec = this.index.record(id);
    if (!rec || rec.entity.type !== type) throw new NotFoundError(type, id);
    const current = await this.files.read(rec.path);
    if (current === null)
      throw new ConflictError(msg(`Datei fehlt: ${rec.path}`, `File missing: ${rec.path}`));
    if (rec.hash === null || hashContent(current) !== rec.hash) {
      // Unknown hash (indexed from metadata cache) or the file changed since indexing
      // (e.g. edited in another pane / synced): re-index from the actual content first.
      this.index.upsert(rec.path, current);
    }
    const fresh = this.index.recordAt(rec.path);
    if (!fresh || fresh.entity.id !== id)
      throw new ConflictError(
        msg(
          `Datei ${rec.path} enthält nicht mehr ${id}`,
          `File ${rec.path} no longer contains ${id}`,
        ),
      );
    if (opts.expectedUpdatedAt && fresh.entity.updated_at !== opts.expectedUpdatedAt) {
      throw new ConflictError(
        msg(
          'Der Datensatz wurde zwischenzeitlich geändert. Bitte neu laden und erneut bearbeiten.',
          'The record was changed in the meantime. Please reload and edit again.',
        ),
        { id },
      );
    }
    const draft = structuredClone(fresh.entity) as EntityMap[T];
    const result = mutate(draft) ?? draft;
    (result as AnyEntity).updated_at = toIso(
      Math.max(this.clock.now(), Date.parse(fresh.entity.updated_at) + 1000),
    );
    (result as AnyEntity).schema_version = SCHEMA_VERSION[type];
    if (result.id !== id || result.type !== type)
      throw new ValidationError(msg('ID und Typ sind unveränderlich', 'ID and type are immutable'));
    const validated = this.validate(type, result as unknown as Record<string, unknown>);
    const parsed = parseNote(current);
    return {
      entity: validated,
      path: rec.path,
      content: this.serialize(validated, fresh.extra, parsed.body),
      before: hashContent(current),
    };
  }

  /** Apply planned writes as one journaled operation and update the index. */
  async commit(label: string, writes: PlannedWrite[]): Promise<void> {
    for (const w of writes) await this.files.ensureFolder(dirname(w.path));
    const jw: JournalWrite[] = writes.map((w) => ({
      path: w.path,
      content: w.content,
      before: w.before,
    }));
    await this.journal.run(label, jw);
    for (const w of writes) this.index.upsert(w.path, w.content);
  }

  /** Run a read-plan-commit sequence exclusively (all writes are serialized). */
  exclusive<R>(fn: () => Promise<R>): Promise<R> {
    return this.mutex.run('write', fn);
  }

  async create<T extends EntityType>(
    type: T,
    input: CreateInput<T>,
    opts: { body?: string; description?: string; path?: string } = {},
  ): Promise<EntityMap[T]> {
    return this.exclusive(async () => {
      const w = await this.planCreate(type, input, opts);
      await this.commit(`create ${type}`, [w]);
      return w.entity as EntityMap[T];
    });
  }

  /** Idempotent create for entities with predetermined IDs (timer commits, recurring tickets). */
  async createIfAbsent<T extends EntityType>(
    type: T,
    input: CreateInput<T> & { id: string },
  ): Promise<'created' | 'exists'> {
    return this.exclusive(async () => {
      if (this.index.hasId(input.id)) return 'exists';
      const entity = this.build(type, input);
      const path = this.paths.pathFor(entity);
      const existing = await this.files.read(path);
      if (existing !== null) {
        // File exists but was not indexed yet (e.g. right after startup): verify it's the same entity.
        this.index.upsert(path, existing);
        if (this.index.hasId(input.id)) return 'exists';
        throw new ConflictError(
          msg(
            `Datei ${path} existiert mit anderem Inhalt`,
            `File ${path} exists with different content`,
          ),
        );
      }
      const w = await this.planCreate(type, input);
      await this.commit(`create ${type}`, [w]);
      return 'created';
    });
  }

  async update<T extends EntityType>(
    type: T,
    id: string,
    mutate: Mutation<EntityMap[T]>,
    opts: UpdateOptions = {},
  ): Promise<EntityMap[T]> {
    return this.exclusive(async () => {
      const w = await this.planUpdate(type, id, mutate, opts);
      await this.commit(opts.label ?? `update ${type}`, [w]);
      return w.entity as EntityMap[T];
    });
  }

  /** Current Markdown body (below the frontmatter), read from the file. */
  async readBody(type: EntityType, id: string): Promise<string> {
    const rec = this.index.record(id);
    if (!rec || rec.entity.type !== type) throw new NotFoundError(type, id);
    const current = await this.files.read(rec.path);
    if (current === null)
      throw new ConflictError(msg(`Datei fehlt: ${rec.path}`, `File missing: ${rec.path}`));
    return parseNote(current).body.replace(/^\n/, '');
  }

  /** Replace the Markdown body; frontmatter is kept (only `updated_at` changes). */
  async updateBody<T extends EntityType>(
    type: T,
    id: string,
    body: string,
    opts: UpdateOptions = {},
  ): Promise<EntityMap[T]> {
    return this.exclusive(async () => {
      const w = await this.planUpdate(type, id, () => undefined, opts);
      const parsed = parseNote(w.content);
      if (!parsed.data)
        throw new ValidationError(
          msg('Frontmatter konnte nicht gelesen werden', 'Frontmatter could not be read'),
        );
      const content = serializeNote(parsed.data, body.startsWith('\n') ? body : `\n${body}`);
      await this.commit(opts.label ?? `update ${type} body`, [{ ...w, content }]);
      return w.entity as EntityMap[T];
    });
  }

  /**
   * Move entity notes to the trash (Obsidian trash / system trash per user setting).
   * Callers must resolve references first (see application/use-cases/delete.ts).
   */
  async trash(ids: string[]): Promise<void> {
    await this.exclusive(async () => {
      for (const id of ids) {
        const path = this.index.pathOf(id);
        if (!path) continue;
        await this.files.trash(path);
        this.index.remove(path);
      }
    });
  }

  async archive(type: EntityType, id: string, archived = true): Promise<void> {
    await this.update(type, id, (d) => {
      d.archived = archived;
      if (d.type === 'customer') d.status = archived ? 'archived' : 'inactive';
    });
  }

  /** Write migrated schema versions back to disk (explicit user command). */
  async writeBackMigrations(): Promise<number> {
    const ids: { type: EntityType; id: string }[] = [];
    for (const t of Object.keys(SCHEMA_VERSION) as EntityType[]) {
      for (const e of this.index.all(t))
        if (this.index.record(e.id)?.migrated) ids.push({ type: t, id: e.id });
    }
    for (const x of ids) await this.update(x.type, x.id, () => undefined, { label: 'migration' });
    return ids.length;
  }
}
