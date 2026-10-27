import { Modal, type App } from 'obsidian';
import { mount, unmount, type Component } from 'svelte';

/** Obsidian modal hosting a Svelte component. The component receives `close` as a prop. */
export class SvelteModal<P extends Record<string, unknown>> extends Modal {
  private instance: Record<string, unknown> | null = null;

  constructor(
    app: App,
    private readonly component: Component<P & { close: () => void }>,
    private readonly props: P,
    private readonly title?: string,
    private readonly wide = false,
    private readonly onClosed?: () => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    if (this.title) this.setTitle(this.title);
    this.modalEl.addClass('lx-modal');
    if (this.wide) this.modalEl.addClass('lx-modal-wide');
    this.instance = mount(this.component, {
      target: this.contentEl,
      props: { ...this.props, close: () => this.close() } as P & { close: () => void },
    });
  }

  override onClose(): void {
    if (this.instance) void unmount(this.instance);
    this.instance = null;
    this.contentEl.empty();
    this.onClosed?.();
  }
}

export class ConfirmModal extends Modal {
  private decided = false;
  constructor(
    app: App,
    private readonly titleText: string,
    private readonly message: string,
    private readonly confirmLabel: string,
    private readonly cancelLabel: string,
    private readonly resolve: (v: boolean) => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.setTitle(this.titleText);
    this.modalEl.addClass('lx-modal');
    for (const para of this.message.split('\n')) this.contentEl.createEl('p', { text: para });
    const bar = this.contentEl.createDiv({ cls: 'lx-modal-actions' });
    const cancel = bar.createEl('button', { text: this.cancelLabel });
    const ok = bar.createEl('button', { text: this.confirmLabel, cls: 'mod-cta' });
    cancel.onclick = () => this.done(false);
    ok.onclick = () => this.done(true);
    window.setTimeout(() => ok.focus(), 0);
  }

  private done(v: boolean): void {
    this.decided = true;
    this.resolve(v);
    this.close();
  }

  override onClose(): void {
    if (!this.decided) this.resolve(false);
    this.contentEl.empty();
  }
}
