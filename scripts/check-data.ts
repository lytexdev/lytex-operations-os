/** Read-only integrity check of a vault's LYTEX data (no writes to the vault). */
import { OpsCore } from '../src/core/bootstrap/core';
import { mergeSettings } from '../src/core/configuration/settings';
import { systemClock } from '../src/shared/date/time';
import type { FileStore } from '../src/infrastructure/persistence/file-store';
import { NodeFileStore, NodeRawStore } from './node-store';

class ReadOnlyStore implements FileStore {
  constructor(private readonly inner: NodeFileStore) {}
  read = (p: string) => this.inner.read(p);
  exists = (p: string) => this.inner.exists(p);
  listMarkdown = (f: string) => this.inner.listMarkdown(f);
  async write(): Promise<void> {
    throw new Error('read-only');
  }
  create = this.write;
  trash = this.write;
  rename = this.write;
  ensureFolder = this.write;
}

export async function check(vaultDir: string, settingsJson: unknown, stateDir: string) {
  const settings = mergeSettings(settingsJson);
  const core = new OpsCore(
    new ReadOnlyStore(new NodeFileStore(vaultDir)),
    new NodeRawStore(stateDir),
    () => settings,
    systemClock,
  );
  await core.rebuildIndex();
  const counts: Record<string, number> = {};
  for (const t of [
    'customer',
    'contact',
    'project',
    'ticket',
    'time_entry',
    'billing_batch',
    'quote',
    'expense',
    'recurring_task',
    'service',
  ] as const)
    counts[t] = core.index.all(t).length;
  return {
    root: settings.rootFolder,
    entities: core.index.size,
    counts,
    issues: core.index.issues(),
  };
}
