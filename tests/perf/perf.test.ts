/**
 * Performance benchmark with the dataset sizes from the specification:
 * 100 customers, 500 projects, 5 000 tickets, 50 000 time entries.
 * Run with: npm run test:perf   (results are printed and checked against soft targets)
 */
import { describe, it, expect } from 'vitest';
import { EntityIndex } from '@/infrastructure/indexing/entity-index';
import { serializeNote, parseNote } from '@/infrastructure/markdown/frontmatter';
import {
  totalsBetween,
  financeSummary,
  projectTotals,
  trackedSecondsByTicket,
  periodRanges,
} from '@/application/queries/aggregates';
import { searchEntities } from '@/application/queries/search';
import { filterTickets } from '@/application/queries/tickets';
import { DEFAULT_WORKFLOW } from '@/domain/policies/workflow';
import { toIso } from '@/shared/date/time';

const TARGETS_MS = {
  indexBuild: 15000,
  indexBuildCached: 3000,
  dashboard: 1500,
  dashboardCached: 50,
  search: 300,
  ticketFilter: 300,
  singleUpdate: 50,
};

function id(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(10, '0')}`;
}

function dataset() {
  const files: { path: string; content: string }[] = [];
  const now = '2026-10-23T08:00:00Z';
  const base = (type: string, i: string) => ({
    type,
    schema_version: 1,
    id: i,
    created_at: now,
    updated_at: now,
    archived: false,
    tags: [],
  });
  for (let c = 0; c < 100; c++) {
    files.push({
      path: `R/01 CRM/Customers/${c}.md`,
      content: serializeNote(
        {
          ...base('customer', id('CUS', c)),
          customer_number: `K-${c}`,
          name: `Kunde ${c} GmbH`,
          address: { street: '', zip: '', city: 'Stadt', country: 'DE' },
        },
        '# Kunde\n',
      ),
    });
  }
  for (let p = 0; p < 500; p++) {
    files.push({
      path: `R/02 Projects/P${p}/Project.md`,
      content: serializeNote(
        {
          ...base('project', id('PRJ', p)),
          project_number: `P-${p}`,
          key: `P${p}`
            .replace(/\d/g, (d) => 'ABCDEFGHIJ'[Number(d)]!)
            .slice(0, 10)
            .padEnd(2, 'X'),
          customer_id: id('CUS', p % 100),
          name: `Projekt ${p}`,
          budget_cents: 1000000,
          estimated_seconds: 360000,
        },
        '# P\n',
      ),
    });
  }
  for (let t = 0; t < 5000; t++) {
    files.push({
      path: `R/02 Projects/P${t % 500}/Tickets/${t}.md`,
      content: serializeNote(
        {
          ...base('ticket', id('TKT', t)),
          ticket_number: `T-${t}`,
          project_id: id('PRJ', t % 500),
          customer_id: id('CUS', (t % 500) % 100),
          title: `Ticket ${t} Wartung Server`,
          status: ['backlog', 'todo', 'in_progress', 'done'][t % 4],
          due_date: t % 7 === 0 ? '2026-10-20' : null,
          estimated_seconds: 7200,
        },
        '# T\n',
      ),
    });
  }
  const start = Date.parse('2025-11-01T08:00:00Z');
  for (let e = 0; e < 50000; e++) {
    const s = start + e * 3 * 3600_000 * 0.15;
    const t = e % 5000;
    files.push({
      path: `R/03 Time/Entries/${e}.md`,
      content: serializeNote(
        {
          ...base('time_entry', id('TIM', e)),
          project_id: id('PRJ', t % 500),
          ticket_id: id('TKT', t),
          customer_id: id('CUS', (t % 500) % 100),
          started_at: toIso(s),
          ended_at: toIso(s + 3600_000),
          duration_seconds: 3600,
          segments: [{ start: toIso(s), end: toIso(s + 3600_000) }],
          billable: e % 5 !== 0,
          rate_cents: 7000,
          billing_status: e % 3 === 0 ? 'invoiced' : 'unbilled',
          billing_batch_id: e % 3 === 0 ? 'BAT-0000000001' : null,
        },
        '\n',
      ),
    });
  }
  return files;
}

function time<T>(fn: () => T): [T, number] {
  const t0 = performance.now();
  const r = fn();
  return [r, Math.round(performance.now() - t0)];
}

describe('performance (55 600 entities)', () => {
  it('meets responsiveness targets', () => {
    const [files, genMs] = time(dataset);
    const index = new EntityIndex();
    const [, buildMs] = time(() => index.load(files));
    expect(index.size).toBe(55600);
    // Obsidian path: frontmatter already parsed by the metadata cache → only validation + indexing.
    const parsed = files.map((f) => ({ path: f.path, data: parseNote(f.content).data! }));
    const index2 = new EntityIndex();
    const [, buildCachedMs] = time(() => {
      for (const f of parsed) index2.upsertData(f.path, f.data, '', null, false);
      index2.load([]);
    });
    expect(index2.size).toBe(55600);
    const today = '2026-10-23';
    const r = periodRanges(today);
    const [, dashMs] = time(() => {
      totalsBetween(index, ...r.today);
      totalsBetween(index, ...r.week);
      totalsBetween(index, ...r.month);
      financeSummary(index);
      for (const p of index.all('project')) projectTotals(index, p.id);
      return filterTickets(index, DEFAULT_WORKFLOW, { preset: 'all' }, today, 'Alex Beispiel', 7)
        .length;
    });
    const [, dashCachedMs] = time(() => {
      totalsBetween(index, ...r.week);
      financeSummary(index);
      return trackedSecondsByTicket(index).size;
    });
    const [hits, searchMs] = time(() => searchEntities(index, 'ticket 4711'));
    const [, filterMs] = time(() =>
      filterTickets(
        index,
        DEFAULT_WORKFLOW,
        { preset: 'overdue', text: 'server' },
        today,
        'Alex Beispiel',
        7,
      ),
    );
    const f = files[files.length - 1]!;
    const [, updateMs] = time(() =>
      index.upsert(f.path, f.content.replace('rate_cents: 7000', 'rate_cents: 7100')),
    );
    const [, refMs] = time(() => index.referenceIssues().length);
    const results = {
      genMs,
      buildMs,
      buildFromMetadataCacheMs: buildCachedMs,
      dashMs,
      dashCachedMs,
      searchMs,
      filterMs,
      updateMs,
      integrityCheckMs: refMs,
    };
    console.warn('PERF', JSON.stringify(results));
    expect(hits.length).toBeGreaterThan(0);
    expect(buildMs).toBeLessThan(TARGETS_MS.indexBuild);
    expect(buildCachedMs).toBeLessThan(TARGETS_MS.indexBuildCached);
    expect(dashMs).toBeLessThan(TARGETS_MS.dashboard);
    expect(dashCachedMs).toBeLessThan(TARGETS_MS.dashboardCached);
    expect(searchMs).toBeLessThan(TARGETS_MS.search);
    expect(filterMs).toBeLessThan(TARGETS_MS.ticketFilter);
    expect(updateMs).toBeLessThan(TARGETS_MS.singleUpdate);
  }, 120000);
});
