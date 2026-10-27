import { SCHEMA_VERSION, type EntityType } from '@/domain/schemas/entities';
import { msg } from '@/shared/i18n';

export type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

/**
 * Migrations per entity type: MIGRATIONS[type][n] migrates from version n to n+1.
 * Version 0 denotes pre-release/hand-written notes without schema_version.
 */
export const MIGRATIONS: Partial<Record<EntityType, Record<number, Migration>>> = {
  ticket: {
    // v1 → v2: single `assignee` string (possibly comma separated) → `assignees` list.
    1: (d) => {
      const out = { ...d };
      if (!Array.isArray(out['assignees'])) {
        const raw = typeof out['assignee'] === 'string' ? (out['assignee'] as string) : '';
        out['assignees'] = raw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      }
      delete out['assignee'];
      return out;
    },
  },
  time_entry: {
    // v0 notes (hand-written) may carry `duration_minutes` and `date` + `start`/`end` strings.
    0: (d) => {
      const out = { ...d };
      if (out['duration_seconds'] === undefined && typeof out['duration_minutes'] === 'number') {
        out['duration_seconds'] = Math.round((out['duration_minutes'] as number) * 60);
        delete out['duration_minutes'];
      }
      return out;
    },
  },
};

export interface MigrationResult {
  data: Record<string, unknown>;
  migrated: boolean;
  from: number;
  to: number;
  error: string | null;
}

export function migrate(
  type: EntityType,
  input: Record<string, unknown>,
  registry = MIGRATIONS,
): MigrationResult {
  const target = SCHEMA_VERSION[type];
  const raw = input['schema_version'];
  const from = raw === undefined ? 0 : Number(raw);
  if (!Number.isInteger(from) || from < 0)
    return {
      data: input,
      migrated: false,
      from: NaN,
      to: target,
      error: msg('Ungültige schema_version', 'Invalid schema_version'),
    };
  if (from > target) {
    return {
      data: input,
      migrated: false,
      from,
      to: target,
      error: msg(
        `Schema-Version ${from} ist neuer als vom Plugin unterstützt (${target}). Bitte Plugin aktualisieren.`,
        `Schema version ${from} is newer than supported by the plugin (${target}). Please update the plugin.`,
      ),
    };
  }
  let data = { ...input };
  for (let v = from; v < target; v++) {
    const m = registry[type]?.[v];
    if (m) data = m(data);
    data['schema_version'] = v + 1;
  }
  return { data, migrated: from !== target, from, to: target, error: null };
}
