import { describe, it, expect } from 'vitest';
import { makeEnv, restart, seedBasic } from '../helpers/fixtures';
import { parseNote, serializeNote } from '@/infrastructure/markdown/frontmatter';
import { updateCustomer } from '@/application/use-cases/crm';
import { migrate } from '@/infrastructure/migrations/migrations';
import { EntityIndex } from '@/infrastructure/indexing/entity-index';
import { DurableJson } from '@/infrastructure/persistence/durable-json';
import { MemoryRawStore } from '@/infrastructure/persistence/memory-store';

describe('frontmatter codec', () => {
  it('round-trips data and body', () => {
    const text = serializeNote(
      {
        type: 'x',
        id: 'CUS-ABC123',
        n: 5,
        s: '0012',
        d: '2026-10-23T08:00:00Z',
        yes: 'yes',
        list: ['a'],
      },
      '# Titel\n\nText',
    );
    const p = parseNote(text);
    expect(p.error).toBeNull();
    expect(p.data).toEqual({
      type: 'x',
      id: 'CUS-ABC123',
      n: 5,
      s: '0012',
      d: '2026-10-23T08:00:00Z',
      yes: 'yes',
      list: ['a'],
    });
    expect(p.body).toBe('\n# Titel\n\nText');
  });

  it('detects unterminated frontmatter and YAML errors', () => {
    expect(parseNote('---\ntype: x\nno end').error).toMatch(/nicht abgeschlossen/);
    expect(parseNote('---\na: [1, 2\n---\n').error).toMatch(/YAML/);
    expect(parseNote('---\na: 1\na: 2\n---\n').error).toMatch(/YAML/);
  });

  it('plain notes without frontmatter are not errors', () => {
    const p = parseNote('# Nur Text');
    expect(p.hasFrontmatter).toBe(false);
    expect(p.error).toBeNull();
  });
});

describe('repository CRUD', () => {
  it('creates, reads, updates, archives', async () => {
    const env = await makeEnv();
    const { customer } = await seedBasic(env);
    expect(customer.customer_number).toBe('K-0001');
    const path = env.core.index.pathOf(customer.id)!;
    expect(path).toBe('LYTEX OS/01 CRM/Customers/K-0001 Muster GmbH.md');
    const text = env.files.files.get(path)!;
    expect(text).toContain('type: customer');
    expect(text).toContain('# Muster GmbH');

    env.clock.advance(5000);
    const updated = await updateCustomer(
      env.core.ctx,
      customer.id,
      { phone: '+49 30 123' },
      customer.updated_at,
    );
    expect(updated.phone).toBe('+49 30 123');
    expect(updated.updated_at > customer.updated_at).toBe(true);
    expect(updated.created_at).toBe(customer.created_at);

    await env.core.repo.archive('customer', customer.id);
    const archived = env.core.repo.get('customer', customer.id);
    expect(archived.archived).toBe(true);
    expect(archived.status).toBe('archived');
    expect(env.files.files.has(path)).toBe(true); // archive is non-destructive
  });

  it('preserves the user-edited body and unknown frontmatter keys on update', async () => {
    const env = await makeEnv();
    const { customer } = await seedBasic(env);
    const path = env.core.index.pathOf(customer.id)!;
    const original = env.files.files.get(path)!;
    const edited = original
      .replace('type: customer', 'type: customer\nmy_custom: hallo')
      .replace('## Notizen', '## Notizen\n\nWichtige Notiz vom Nutzer');
    env.files.files.set(path, edited);
    env.core.index.upsert(path, edited);
    await updateCustomer(env.core.ctx, customer.id, { phone: '1' });
    const after = env.files.files.get(path)!;
    expect(after).toContain('Wichtige Notiz vom Nutzer');
    expect(after).toContain('my_custom: hallo');
  });

  it('detects conflicts via expectedUpdatedAt', async () => {
    const env = await makeEnv();
    const { customer } = await seedBasic(env);
    env.clock.advance(1000);
    await updateCustomer(env.core.ctx, customer.id, { phone: '1' });
    await expect(
      updateCustomer(env.core.ctx, customer.id, { phone: '2' }, customer.updated_at),
    ).rejects.toThrow(/zwischenzeitlich/);
  });

  it('detects external file changes before writing', async () => {
    const env = await makeEnv();
    const { customer } = await seedBasic(env);
    const path = env.core.index.pathOf(customer.id)!;
    // External edit (another device via sync) without going through the index.
    env.files.files.set(
      path,
      env.files.files.get(path)!.replace(/updated_at: .*/, 'updated_at: 2027-01-01T00:00:00Z'),
    );
    await expect(
      updateCustomer(env.core.ctx, customer.id, { phone: '2' }, customer.updated_at),
    ).rejects.toThrow(/zwischenzeitlich/);
  });

  it('rejects invalid data with validation messages', async () => {
    const env = await makeEnv();
    const { customer } = await seedBasic(env);
    await expect(
      env.core.repo.update('customer', customer.id, (d) => ({ ...d, name: '' })),
    ).rejects.toThrow(/Name ist erforderlich/);
    await expect(
      env.core.repo.update('customer', customer.id, (d) => ({ ...d, id: 'CUS-OTHER1' })),
    ).rejects.toThrow(/unveränderlich/);
  });

  it('never touches files outside the root folder', async () => {
    const env = await makeEnv();
    env.files.files.set('Privat/Tagebuch.md', '---\ntype: customer\nid: CUS-FOREIGN1\n---\n');
    await env.core.rebuildIndex();
    expect(env.core.index.hasId('CUS-FOREIGN1')).toBe(false);
    await seedBasic(env);
    expect(env.files.files.get('Privat/Tagebuch.md')).toBe(
      '---\ntype: customer\nid: CUS-FOREIGN1\n---\n',
    );
  });
});

describe('corruption, duplicates, recovery', () => {
  it('reports corrupt and invalid files without crashing', async () => {
    const env = await makeEnv();
    await seedBasic(env);
    env.files.files.set('LYTEX OS/01 CRM/Customers/kaputt.md', '---\ntype: customer\nid: [\n---\n');
    env.files.files.set(
      'LYTEX OS/01 CRM/Customers/ungueltig.md',
      '---\ntype: customer\nid: CUS-INVALID1\nschema_version: 1\n---\n',
    );
    env.files.files.set('LYTEX OS/00 Dashboard/Home.md', '# Kein Entity');
    await env.core.rebuildIndex();
    const issues = env.core.index.issues();
    expect(issues.some((i) => i.kind === 'parse' && i.path.endsWith('kaputt.md'))).toBe(true);
    expect(issues.some((i) => i.kind === 'schema' && i.path.endsWith('ungueltig.md'))).toBe(true);
    expect(env.core.index.all('customer')).toHaveLength(1);
  });

  it('detects duplicate IDs (e.g. copied notes) and keeps a deterministic primary', async () => {
    const env = await makeEnv();
    const { customer } = await seedBasic(env);
    const path = env.core.index.pathOf(customer.id)!;
    env.files.files.set(path.replace('.md', ' Kopie.md'), env.files.files.get(path)!);
    await env.core.rebuildIndex();
    const dups = env.core.index.issues().filter((i) => i.kind === 'duplicate_id');
    expect(dups).toHaveLength(1);
    expect(env.core.index.all('customer')).toHaveLength(1);
  });

  it('reports broken references', async () => {
    const env = await makeEnv();
    const { ticket } = await seedBasic(env);
    const path = env.core.index.pathOf(ticket.id)!;
    env.files.files.set(
      path,
      env.files.files.get(path)!.replace(/project_id: .*/, 'project_id: PRJ-MISSING01'),
    );
    await env.core.rebuildIndex();
    expect(env.core.index.issues().some((i) => i.kind === 'broken_ref' && i.id === ticket.id)).toBe(
      true,
    );
  });

  it('interrupted write (truncated file) is rolled forward by the journal on restart', async () => {
    const env = await makeEnv();
    const { customer } = await seedBasic(env);
    const path = env.core.index.pathOf(customer.id)!;
    env.files.failNextWrite = { match: (p) => p === path, truncateTo: 30 };
    await expect(updateCustomer(env.core.ctx, customer.id, { phone: '+49 1' })).rejects.toThrow(
      /Simulated/,
    );
    expect(env.files.files.get(path)!.length).toBe(30);
    const env2 = await restart(env);
    expect(env2.core.repo.get('customer', customer.id).phone).toBe('+49 1');
    expect(env2.core.index.issues().filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  it('journal does not overwrite a file that was changed externally after a crash', async () => {
    const env = await makeEnv();
    const { customer } = await seedBasic(env);
    const path = env.core.index.pathOf(customer.id)!;
    env.files.failNextWrite = { match: (p) => p === path };
    await expect(updateCustomer(env.core.ctx, customer.id, { phone: 'A' })).rejects.toThrow();
    const external = env.files.files
      .get(path)!
      .replace('# Muster GmbH', '# Muster GmbH (extern geändert)');
    env.files.files.set(path, external);
    const env2 = await restart(env);
    expect(env2.files.files.get(path)).toBe(external);
    const conflicts = [...env2.raw.data.keys()].filter((k) => k.startsWith('conflicts/'));
    expect(conflicts).toHaveLength(1);
  });

  it('index rebuild after startup equals incremental index', async () => {
    const env = await makeEnv();
    await seedBasic(env);
    const before = env.core.index.size;
    const env2 = await restart(env);
    expect(env2.core.index.size).toBe(before);
  });
});

describe('migrations', () => {
  it('migrates v0 time entries in memory and writes back on demand', async () => {
    const r = migrate('time_entry', { type: 'time_entry', duration_minutes: 90 });
    expect(r.migrated).toBe(true);
    expect(r.data['duration_seconds']).toBe(5400);
    expect(r.data['schema_version']).toBe(1);
  });

  it('refuses newer schema versions', () => {
    const r = migrate('customer', { schema_version: 99 });
    expect(r.error).toMatch(/neuer/);
    const idx = new EntityIndex();
    idx.upsert('a.md', '---\ntype: customer\nschema_version: 99\nid: CUS-NEWER01\n---\n');
    expect(idx.issues()[0]!.kind).toBe('migration');
  });

  it('write-back of migrated entities', async () => {
    const env = await makeEnv();
    const { project } = await seedBasic(env);
    const path = 'LYTEX OS/03 Time/Entries/2026/10/TIM-LEGACY0001.md';
    env.files.files.set(
      path,
      `---\ntype: time_entry\nid: TIM-LEGACY0001\ncreated_at: 2026-10-01T08:00:00Z\nupdated_at: 2026-10-01T08:00:00Z\nproject_id: ${project.id}\nstarted_at: 2026-10-01T08:00:00Z\nended_at: 2026-10-01T09:30:00Z\nduration_minutes: 90\nbillable: true\nrate_cents: 7000\n---\nAlt\n`,
    );
    await env.core.rebuildIndex();
    expect(env.core.index.record('TIM-LEGACY0001')!.migrated).toBe(true);
    const n = await env.core.repo.writeBackMigrations();
    expect(n).toBe(1);
    expect(env.files.files.get(path)).toContain('schema_version: 1');
    expect(env.files.files.get(path)).toContain('duration_seconds: 5400');
    expect(env.files.files.get(path)).toContain('Alt');
  });
});

describe('DurableJson', () => {
  it('survives a torn write by using the other slot', async () => {
    const raw = new MemoryRawStore();
    const j = new DurableJson<{ n: number }>(raw, 'x');
    await j.save({ n: 1 });
    await j.save({ n: 2 });
    raw.failNextWrite = { match: () => true, truncateTo: 10 };
    await expect(j.save({ n: 3 })).rejects.toThrow();
    const j2 = new DurableJson<{ n: number }>(raw, 'x');
    expect(await j2.load()).toEqual({ n: 2 });
    await j2.save({ n: 4 });
    expect(await new DurableJson<{ n: number }>(raw, 'x').load()).toEqual({ n: 4 });
  });
});
