import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { FileStore, RawStore } from '../src/infrastructure/persistence/file-store';

/** Node.js FileStore for scripts (example vault, benchmarks). Not used by the plugin. */
export class NodeFileStore implements FileStore {
  constructor(private readonly root: string) {}
  private abs(p: string): string {
    return path.join(this.root, p);
  }
  async read(p: string): Promise<string | null> {
    try {
      return await fs.readFile(this.abs(p), 'utf8');
    } catch {
      return null;
    }
  }
  async write(p: string, c: string): Promise<void> {
    await fs.mkdir(path.dirname(this.abs(p)), { recursive: true });
    await fs.writeFile(this.abs(p), c, 'utf8');
  }
  async create(p: string, c: string): Promise<void> {
    await fs.mkdir(path.dirname(this.abs(p)), { recursive: true });
    await fs.writeFile(this.abs(p), c, { encoding: 'utf8', flag: 'wx' });
  }
  async exists(p: string): Promise<boolean> {
    try {
      await fs.stat(this.abs(p));
      return true;
    } catch {
      return false;
    }
  }
  async listMarkdown(folder: string): Promise<string[]> {
    const out: string[] = [];
    const walk = async (rel: string) => {
      let entries;
      try {
        entries = await fs.readdir(this.abs(rel), { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) await walk(r);
        else if (e.name.endsWith('.md')) out.push(r);
      }
    };
    await walk(folder);
    return out;
  }
  async trash(p: string): Promise<void> {
    await fs.rm(this.abs(p), { force: true });
  }
  async rename(a: string, b: string): Promise<void> {
    await fs.mkdir(path.dirname(this.abs(b)), { recursive: true });
    await fs.rename(this.abs(a), this.abs(b));
  }
  async ensureFolder(p: string): Promise<void> {
    await fs.mkdir(this.abs(p), { recursive: true });
  }
}

export class NodeRawStore implements RawStore {
  constructor(private readonly dir: string) {}
  async read(k: string): Promise<string | null> {
    try {
      return await fs.readFile(path.join(this.dir, k), 'utf8');
    } catch {
      return null;
    }
  }
  async write(k: string, c: string): Promise<void> {
    await fs.mkdir(path.dirname(path.join(this.dir, k)), { recursive: true });
    await fs.writeFile(path.join(this.dir, k), c, 'utf8');
  }
  async remove(k: string): Promise<void> {
    await fs.rm(path.join(this.dir, k), { force: true });
  }
  async list(prefix: string): Promise<string[]> {
    try {
      return (await fs.readdir(this.dir)).filter((f) => f.startsWith(prefix));
    } catch {
      return [];
    }
  }
}
