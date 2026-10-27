/**
 * Minimal file abstraction so repositories can be tested without Obsidian.
 * Paths are vault-relative and use "/" separators.
 */
export interface FileStore {
  read(path: string): Promise<string | null>;
  /** Create or overwrite a file (parent folders are created as needed). */
  write(path: string, content: string): Promise<void>;
  /** Create only; rejects if the file exists. */
  create(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** All markdown file paths below the folder (recursive). */
  listMarkdown(folder: string): Promise<string[]>;
  /** Move to trash (never hard-delete user data). */
  trash(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  ensureFolder(path: string): Promise<void>;
}

/** Key/value storage for plugin-internal state (timer session, journal); not part of the vault notes. */
export interface RawStore {
  read(key: string): Promise<string | null>;
  write(key: string, content: string): Promise<void>;
  remove(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function joinPath(...parts: string[]): string {
  return parts
    .filter((p) => p !== '')
    .join('/')
    .replace(/\/+/g, '/')
    .replace(/^\/|\/$/g, '');
}
