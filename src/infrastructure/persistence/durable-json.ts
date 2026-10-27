import type { RawStore } from './file-store';
import { fnv1a } from '@/shared/utilities/hash';

interface Envelope<T> {
  seq: number;
  checksum: string;
  payload: T;
}

/**
 * Crash-tolerant JSON storage without relying on atomic rename: writes alternate between two
 * slots (`<key>.a.json` / `<key>.b.json`), each carrying a sequence number and checksum.
 * A torn write corrupts at most the slot being written; load() returns the newest valid slot.
 */
export class DurableJson<T> {
  private seq = 0;

  constructor(
    private readonly store: RawStore,
    private readonly key: string,
  ) {}

  private slot(n: number): string {
    return `${this.key}.${n % 2 === 0 ? 'a' : 'b'}.json`;
  }

  private async readSlot(name: string): Promise<Envelope<T> | null> {
    const raw = await this.store.read(name);
    if (!raw) return null;
    try {
      const env = JSON.parse(raw) as Envelope<T>;
      if (typeof env.seq !== 'number' || fnv1a(JSON.stringify(env.payload)) !== env.checksum)
        return null;
      return env;
    } catch {
      return null;
    }
  }

  async load(): Promise<T | null> {
    const [a, b] = await Promise.all([this.readSlot(this.slot(0)), this.readSlot(this.slot(1))]);
    const best = !a ? b : !b ? a : a.seq >= b.seq ? a : b;
    this.seq = Math.max(a?.seq ?? 0, b?.seq ?? 0);
    return best ? best.payload : null;
  }

  async save(payload: T): Promise<void> {
    const seq = this.seq + 1;
    const env: Envelope<T> = { seq, checksum: fnv1a(JSON.stringify(payload)), payload };
    await this.store.write(this.slot(seq), JSON.stringify(env));
    this.seq = seq;
  }
}
