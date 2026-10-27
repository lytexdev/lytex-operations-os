import type { Readable } from 'svelte/store';
import type { OpsCore } from '@/core/bootstrap/core';
import type { AppContext } from '@/application/context';
import type { LytexSettings } from '@/core/configuration/settings';
import type { TimerContext, TimerSession } from '@/domain/services/timer';
import type { Router } from '../navigation/router';

export type FormKind =
  | 'customer'
  | 'contact'
  | 'interaction'
  | 'project'
  | 'ticket'
  | 'time'
  | 'adjust'
  | 'quote'
  | 'expense'
  | 'recurring'
  | 'service'
  | 'invoice'
  | 'payment';

export interface FormRequest {
  kind: FormKind;
  id?: string;
  preset?: Record<string, unknown>;
}

/**
 * Everything UI components may use. Components never touch Obsidian APIs or the file system
 * directly; they call use cases through `ctx` and UI services through this interface.
 */
export interface UiApi {
  core: OpsCore;
  ctx: AppContext;
  settings(): LytexSettings;
  /** Increments (debounced) whenever the entity index changes. */
  version: Readable<number>;
  timer: Readable<TimerSession | null>;
  /** Wall clock, updated every second while a view is open. */
  now: Readable<number>;
  router: Router;
  openNote(idOrPath: string, newLeaf?: boolean): void;
  notify(message: string, kind?: 'info' | 'success' | 'error'): void;
  confirm(title: string, message: string, confirmLabel?: string): Promise<boolean>;
  /** Run an action, show errors as notices; resolves undefined on failure. */
  run<T>(fn: () => Promise<T>, success?: string): Promise<T | undefined>;
  openForm(req: FormRequest): void;
  startTimer(ctx: Partial<TimerContext> & { project_id: string }): Promise<void>;
  stopTimer(): Promise<void>;
  openTimerPanel(): void;
  openRecovery(): void;
  pickEntity(type: 'customer' | 'project' | 'ticket', placeholder?: string): Promise<string | null>;
  /** Persist settings (and apply theme changes). */
  saveSettings(): Promise<void>;
  /** Render Markdown into `el` with Obsidian's renderer; returns a cleanup function. */
  renderMarkdown(el: HTMLElement, markdown: string, sourcePath: string): Promise<() => void>;
  /** Store an uploaded file in the project's Attachments folder; returns its vault path. */
  saveAttachment(projectId: string, file: File): Promise<string>;
  /** Secrets live in Obsidian's Keychain (app.secretStorage), never in notes or data.json. */
  secrets: {
    available: boolean;
    has(id: SecretId): boolean;
    hint(id: SecretId): string;
    set(id: SecretId, value: string): void;
    clear(id: SecretId): void;
  };
  /** Open the plugin page of Obsidian's settings dialog. */
  openPluginSettings(): void;
}

export type SecretId = 'lytex-lexware-api-key' | 'lytex-openai-api-key' | 'lytex-deepl-api-key';
