import type { TimerEntrySink, TimerPersistedState, TimerStore } from '@/domain/services/timer';
import type { RawStore } from '../persistence/file-store';
import { DurableJson } from '../persistence/durable-json';
import type { Repository, CreateInput } from '../persistence/repository';

/** Timer state lives in plugin storage (not in vault notes) and uses the crash-tolerant two-slot format. */
export class DurableTimerStore implements TimerStore {
  private readonly json: DurableJson<TimerPersistedState>;
  constructor(raw: RawStore) {
    this.json = new DurableJson<TimerPersistedState>(raw, 'timer');
  }
  load(): Promise<TimerPersistedState | null> {
    return this.json.load();
  }
  save(state: TimerPersistedState): Promise<void> {
    return this.json.save(state);
  }
}

export class RepositoryEntrySink implements TimerEntrySink {
  constructor(private readonly repo: Repository) {}
  createIfAbsent(entry: Record<string, unknown>): Promise<'created' | 'exists'> {
    return this.repo.createIfAbsent(
      'time_entry',
      entry as CreateInput<'time_entry'> & { id: string },
    );
  }
  async exists(entryId: string): Promise<boolean> {
    return this.repo.index.hasId(entryId);
  }
}
