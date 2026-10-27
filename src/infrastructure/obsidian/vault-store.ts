import { normalizePath, TFile, TFolder, type App } from 'obsidian';
import type { FileStore, RawStore } from '../persistence/file-store';
import { dirname } from '../persistence/file-store';
import { msg } from '@/shared/i18n';

/** FileStore backed by the official Obsidian Vault API. */
export class VaultFileStore implements FileStore {
  constructor(private readonly app: App) {}

  private file(path: string): TFile | null {
    return this.app.vault.getFileByPath(normalizePath(path));
  }

  async read(path: string): Promise<string | null> {
    const f = this.file(path);
    return f ? this.app.vault.read(f) : null;
  }

  /** Fast read for index building (uses Obsidian's cache when available). */
  async cachedRead(path: string): Promise<string | null> {
    const f = this.file(path);
    return f ? this.app.vault.cachedRead(f) : null;
  }

  async write(path: string, content: string): Promise<void> {
    const f = this.file(path);
    if (f) {
      await this.app.vault.modify(f, content);
      return;
    }
    await this.ensureFolder(dirname(path));
    await this.app.vault.create(normalizePath(path), content);
  }

  async create(path: string, content: string): Promise<void> {
    await this.ensureFolder(dirname(path));
    await this.app.vault.create(normalizePath(path), content);
  }

  async exists(path: string): Promise<boolean> {
    const p = normalizePath(path);
    return (
      this.app.vault.getAbstractFileByPath(p) !== null || (await this.app.vault.adapter.exists(p))
    );
  }

  async listMarkdown(folder: string): Promise<string[]> {
    const prefix = folder ? `${normalizePath(folder)}/` : '';
    return this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith(prefix))
      .map((f) => f.path);
  }

  async trash(path: string): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (f) await this.app.fileManager.trashFile(f);
  }

  async rename(from: string, to: string): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(normalizePath(from));
    if (!f) throw new Error(msg(`Datei fehlt: ${from}`, `File missing: ${from}`));
    await this.ensureFolder(dirname(to));
    await this.app.fileManager.renameFile(f, normalizePath(to));
  }

  async ensureFolder(path: string): Promise<void> {
    if (!path) return;
    const p = normalizePath(path);
    const existing = this.app.vault.getAbstractFileByPath(p);
    if (existing instanceof TFolder) return;
    if (existing)
      throw new Error(msg(`${p} ist eine Datei, kein Ordner`, `${p} is a file, not a folder`));
    const parent = dirname(p);
    if (parent) await this.ensureFolder(parent);
    try {
      await this.app.vault.createFolder(p);
    } catch (e) {
      // Folder may have been created concurrently.
      if (!(this.app.vault.getAbstractFileByPath(p) instanceof TFolder)) throw e;
    }
  }
}

/** Plugin-private state (timer session, journal) under .obsidian/plugins/<id>/state. */
export class PluginRawStore implements RawStore {
  constructor(
    private readonly app: App,
    private readonly dir: string,
  ) {}

  private p(key: string): string {
    return normalizePath(`${this.dir}/${key}`);
  }

  private async mkdirFor(path: string): Promise<void> {
    const d = dirname(path);
    if (d && !(await this.app.vault.adapter.exists(d))) await this.app.vault.adapter.mkdir(d);
  }

  async read(key: string): Promise<string | null> {
    const path = this.p(key);
    return (await this.app.vault.adapter.exists(path)) ? this.app.vault.adapter.read(path) : null;
  }

  async write(key: string, content: string): Promise<void> {
    const path = this.p(key);
    await this.mkdirFor(path);
    await this.app.vault.adapter.write(path, content);
  }

  async remove(key: string): Promise<void> {
    const path = this.p(key);
    if (await this.app.vault.adapter.exists(path)) await this.app.vault.adapter.remove(path);
  }

  async list(prefix: string): Promise<string[]> {
    const base = this.p('');
    if (!(await this.app.vault.adapter.exists(base))) return [];
    const out: string[] = [];
    const walk = async (dir: string) => {
      const l = await this.app.vault.adapter.list(dir);
      for (const f of l.files) out.push(f.slice(base.length + 1));
      for (const d of l.folders) await walk(d);
    };
    await walk(base);
    return out.filter((k) => k.startsWith(prefix));
  }
}
