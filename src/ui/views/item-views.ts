import { ItemView, type WorkspaceLeaf } from 'obsidian';
import { mount, unmount } from 'svelte';
import type { UiApi } from '../stores/ui-api';
import App from './App.svelte';
import TimerPanel from './TimerPanel.svelte';
import { t } from '@/shared/i18n';

export const VIEW_MAIN = 'lytex-ops-main';
export const VIEW_TIMER = 'lytex-ops-timer';

abstract class SvelteItemView extends ItemView {
  private instance: Record<string, unknown> | null = null;
  constructor(
    leaf: WorkspaceLeaf,
    protected readonly api: () => UiApi | null,
  ) {
    super(leaf);
  }

  protected abstract component(): typeof App | typeof TimerPanel;

  override async onOpen(): Promise<void> {
    this.render();
  }

  /** (Re)mount once the core is ready; shows a loading state until then. */
  render(): void {
    if (this.instance) {
      void unmount(this.instance);
      this.instance = null;
    }
    this.contentEl.empty();
    this.contentEl.addClass('lx-root');
    const api = this.api();
    if (!api) {
      this.contentEl.createDiv({ cls: 'lx-loading', text: t('app.loading') });
      return;
    }
    this.instance = mount(this.component(), { target: this.contentEl, props: { api } });
  }

  override async onClose(): Promise<void> {
    if (this.instance) await unmount(this.instance);
    this.instance = null;
  }
}

export class MainView extends SvelteItemView {
  getViewType(): string {
    return VIEW_MAIN;
  }
  getDisplayText(): string {
    return t('app.name');
  }
  override getIcon(): string {
    return 'briefcase';
  }
  protected component() {
    return App;
  }
}

export class TimerView extends SvelteItemView {
  getViewType(): string {
    return VIEW_TIMER;
  }
  getDisplayText(): string {
    return `${t('app.short')} – ${t('timer.title')}`;
  }
  override getIcon(): string {
    return 'timer';
  }
  protected component() {
    return TimerPanel;
  }
}
