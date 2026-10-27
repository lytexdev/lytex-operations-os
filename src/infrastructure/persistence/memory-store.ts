import type { FileStore, RawStore } from './file-store';

/** In-memory FileStore with failure injection for tests and benchmarks. */
export class MemoryFileStore implements FileStore {
  files = new Map<string, string>();
  folders = new Set<string>();
  trashed = new Map<string, string>();
  /** If set, the next write to a matching path writes only a truncated prefix and throws. */
  failNextWrite: { match: (p: string) => boolean; truncateTo?: number } | null = null;
  writes = 0;

  async read(path: string): Promise<string | null> {
    return this.files.get(path) ?? null;
  }

  private doWrite(path: string, content: string): void {
    this.writes++;
    const f = this.failNextWrite;
    if (f && f.match(path)) {
      this.failNextWrite = null;
      if (f.truncateTo !== undefined) this.files.set(path, content.slice(0, f.truncateTo));
      throw new Error(`Simulated write failure: ${path}`);
    }
    this.files.set(path, content);
  }

  async write(path: string, content: string): Promise<void> {
    this.doWrite(path, content);
  }

  async create(path: string, content: string): Promise<void> {
    if (this.files.has(path)) throw new Error(`File exists: ${path}`);
    this.doWrite(path, content);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.folders.has(path);
  }

  async listMarkdown(folder: string): Promise<string[]> {
    const prefix = folder ? `${folder}/` : '';
    return [...this.files.keys()].filter((p) => p.startsWith(prefix) && p.endsWith('.md'));
  }

  async trash(path: string): Promise<void> {
    const c = this.files.get(path);
    if (c !== undefined) this.trashed.set(path, c);
    this.files.delete(path);
  }

  async rename(from: string, to: string): Promise<void> {
    const c = this.files.get(from);
    if (c === undefined) throw new Error(`Missing: ${from}`);
    if (this.files.has(to)) throw new Error(`Exists: ${to}`);
    this.files.delete(from);
    this.files.set(to, c);
  }

  async ensureFolder(path: string): Promise<void> {
    this.folders.add(path);
  }
}

export class MemoryRawStore implements RawStore {
  data = new Map<string, string>();
  failNextWrite: { match: (k: string) => boolean; truncateTo?: number } | null = null;

  async read(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }
  async write(key: string, content: string): Promise<void> {
    const f = this.failNextWrite;
    if (f && f.match(key)) {
      this.failNextWrite = null;
      if (f.truncateTo !== undefined) this.data.set(key, content.slice(0, f.truncateTo));
      throw new Error(`Simulated write failure: ${key}`);
    }
    this.data.set(key, content);
  }
  async remove(key: string): Promise<void> {
    this.data.delete(key);
  }
  async list(prefix: string): Promise<string[]> {
    return [...this.data.keys()].filter((k) => k.startsWith(prefix));
  }
}
