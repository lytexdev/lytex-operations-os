import {
  Plugin,
  Notice,
  TFile,
  Menu,
  Component as ObsidianComponent,
  MarkdownRenderer,
  normalizePath,
  moment,
  type TAbstractFile,
  type WorkspaceLeaf,
} from 'obsidian';
import { readable, writable, type Readable } from 'svelte/store';
import { OpsCore } from '@/core/bootstrap/core';
import {
  mergeSettings,
  localizeFreshDefaults,
  SETTINGS_VERSION,
  type LytexSettings,
} from '@/core/configuration/settings';
import { themeColors } from '@/shared/utilities/color';
import { migrateLegacyAssignees } from '@/application/use-cases/tickets';
import { safeFileName } from '@/shared/utilities/text';
import { VaultFileStore, PluginRawStore } from '@/infrastructure/obsidian/vault-store';
import { writeOverviewNotes } from '@/infrastructure/markdown/generated-notes';
import { systemClock, formatDuration, localDate } from '@/shared/date/time';
import { setLocale, t, msg, resolveLocale } from '@/shared/i18n';
import { errorMessage } from '@/domain/errors/errors';
import type { TimerContext, TimerSession } from '@/domain/services/timer';
import { sessionElapsedSeconds } from '@/domain/services/timer';
import { reconcileRecurring } from '@/application/use-cases/recurring';
import { Router } from '@/ui/navigation/router';
import type { FormRequest, SecretId, UiApi } from '@/ui/stores/ui-api';
import { MainView, TimerView, VIEW_MAIN, VIEW_TIMER } from '@/ui/views/item-views';
import { LytexSettingTab } from '@/ui/views/settings-tab';
import { SvelteModal, ConfirmModal } from '@/ui/modals/svelte-modal';
import { EntityPickerModal } from '@/ui/modals/entity-picker';
import CustomerForm from '@/ui/forms/CustomerForm.svelte';
import ContactForm from '@/ui/forms/ContactForm.svelte';
import InteractionForm from '@/ui/forms/InteractionForm.svelte';
import ProjectForm from '@/ui/forms/ProjectForm.svelte';
import TicketForm from '@/ui/forms/TicketForm.svelte';
import TimeEntryForm from '@/ui/forms/TimeEntryForm.svelte';
import AdjustForm from '@/ui/forms/AdjustForm.svelte';
import QuoteForm from '@/ui/forms/QuoteForm.svelte';
import ExpenseForm from '@/ui/forms/ExpenseForm.svelte';
import RecurringForm from '@/ui/forms/RecurringForm.svelte';
import ServiceForm from '@/ui/forms/ServiceForm.svelte';
import InvoiceForm from '@/ui/forms/InvoiceForm.svelte';
import RecoveryForm from '@/ui/forms/RecoveryForm.svelte';
import type { Component } from 'svelte';

const THEME_VARS = [
  '--lx-brand-light',
  '--lx-brand-dark',
  '--lx-on-brand-light',
  '--lx-on-brand-dark',
] as const;

const FORMS: Record<
  FormRequest['kind'],
  { component: Component<never>; title: (edit: boolean) => string; wide?: boolean }
> = {
  customer: {
    component: CustomerForm as Component<never>,
    title: (e) => t(e ? 'customer.edit' : 'customer.new'),
    wide: true,
  },
  contact: { component: ContactForm as Component<never>, title: () => t('contact.new') },
  interaction: {
    component: InteractionForm as Component<never>,
    title: () => t('interaction.new'),
  },
  project: {
    component: ProjectForm as Component<never>,
    title: (e) => t(e ? 'project.edit' : 'project.new'),
    wide: true,
  },
  ticket: {
    component: TicketForm as Component<never>,
    title: (e) => t(e ? 'ticket.edit' : 'ticket.new'),
    wide: true,
  },
  time: {
    component: TimeEntryForm as Component<never>,
    title: (e) => t(e ? 'time.edit' : 'time.manual'),
    wide: true,
  },
  adjust: { component: AdjustForm as Component<never>, title: () => t('time.adjust') },
  quote: { component: QuoteForm as Component<never>, title: () => t('quote.new'), wide: true },
  expense: {
    component: ExpenseForm as Component<never>,
    title: () => t('expense.new'),
    wide: true,
  },
  recurring: {
    component: RecurringForm as Component<never>,
    title: () => t('recurring.new'),
    wide: true,
  },
  service: { component: ServiceForm as Component<never>, title: () => t('service.new') },
  invoice: { component: InvoiceForm as Component<never>, title: () => t('billing.confirmInvoice') },
  payment: { component: InvoiceForm as Component<never>, title: () => t('billing.recordPayment') },
};

export default class LytexOpsPlugin extends Plugin {
  declare settings: LytexSettings;
  core: OpsCore | null = null;
  private api: UiApi | null = null;
  private files!: VaultFileStore;
  private version = writable(0);
  private timerStore = writable<TimerSession | null>(null);
  private router = new Router();
  private statusEl: HTMLElement | null = null;
  private versionTimer: number | null = null;
  private lastReconcileDay = '';
  private recoveryOpen = false;
  /** Root folder the current index was built from. */
  private indexedRoot = '';

  override async onload(): Promise<void> {
    await this.loadSettings();
    this.registerView(VIEW_MAIN, (leaf) => new MainView(leaf, () => this.api));
    this.registerView(VIEW_TIMER, (leaf) => new TimerView(leaf, () => this.api));
    this.addSettingTab(new LytexSettingTab(this.app, this));
    this.addRibbonIcon('briefcase', t('app.name'), () => void this.activateMain());
    this.addRibbonIcon(
      'timer',
      `${t('app.short')}: ${t('timer.title')}`,
      () => void this.activateTimer(),
    );
    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass('lx-statusbar', 'mod-clickable');
    this.statusEl.onClickEvent(() => void this.activateTimer());
    this.registerCommands();
    this.app.workspace.onLayoutReady(() => void this.initCore());
  }

  override onunload(): void {
    // Timer state is persisted on every change; nothing to flush. Views are detached by Obsidian.
    if (this.versionTimer) window.clearTimeout(this.versionTimer);
    for (const v of THEME_VARS) document.body.style.removeProperty(v);
  }

  async loadSettings(): Promise<void> {
    const raw = (await this.loadData()) as { settingsVersion?: number } | null;
    this.settings = mergeSettings(raw);
    this.applyLocale();
    if (!raw) localizeFreshDefaults(this.settings);
    this.applyTheme();
    // Persist settings migrations (e.g. workflow without "Blockiert", team defaults) once.
    if (raw && (raw.settingsVersion ?? 1) < SETTINGS_VERSION) await this.saveData(this.settings);
  }

  /** UI language: explicit setting or Obsidian's own language (moment's global locale). */
  private applyLocale(): void {
    setLocale(resolveLocale(this.settings.locale, moment.locale()));
  }

  /** Accent colour as CSS variables on <body> (used by views, modals and the status bar). */
  applyTheme(): void {
    const c = themeColors(this.settings.accentColor);
    const vars: Record<(typeof THEME_VARS)[number], string> = {
      '--lx-brand-light': c.light,
      '--lx-brand-dark': c.dark,
      '--lx-on-brand-light': c.onLight,
      '--lx-on-brand-dark': c.onDark,
    };
    for (const [k, v] of Object.entries(vars)) document.body.style.setProperty(k, v);
  }

  async saveSettings(): Promise<void> {
    const rootChanged = this.core !== null && this.indexedRoot !== this.settings.rootFolder;
    await this.saveData(this.settings);
    this.applyLocale();
    this.applyTheme();
    if (rootChanged) {
      // New root: create the full folder structure there and index it. Existing data are not moved.
      await this.setupStructure(false);
      await this.rebuild();
    } else if (this.core) {
      await writeOverviewNotes(this.files, this.settings, true).catch((e) =>
        console.error('[LYTEX OS] overview notes', e),
      );
    }
    this.version.update((v) => v + 1);
  }

  private async initCore(): Promise<void> {
    const t0 = performance.now();
    try {
      this.files = new VaultFileStore(this.app);
      const raw = new PluginRawStore(
        this.app,
        `${this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`}/state`,
      );
      const core = new OpsCore(this.files, raw, () => this.settings, systemClock);
      if (!this.settings.initialized) {
        await this.setupStructure(false, core);
        this.settings.initialized = true;
        await this.saveData(this.settings);
      }
      const report = await core.start({
        read: (p) => this.files.cachedRead(p),
        frontmatter: (p) => this.cachedFrontmatter(p),
      });
      this.core = core;
      this.indexedRoot = this.settings.rootFolder;
      this.lastReconcileDay = localDate(Date.now());
      core.index.subscribe(() => this.bumpVersion());
      core.timer.subscribe((s) => {
        this.timerStore.set(s);
        this.updateStatusBar();
        if (s?.state === 'recovering') this.openRecovery();
      });
      this.timerStore.set(core.timer.session);
      await this.runDataMigrations(core);
      this.api = this.buildApi(core);
      this.registerVaultEvents();
      this.registerTimerLoops();
      this.rerenderViews();
      this.updateStatusBar();
      const ms = Math.round(performance.now() - t0);
      console.warn(
        msg(
          `[LYTEX OS] ${report.entities} Datensätze aus ${report.files} Dateien in ${ms} ms geladen`,
          `[LYTEX OS] ${report.entities} records from ${report.files} files loaded in ${ms} ms`,
        ),
      );
      if (report.recovery.replayed || report.recovery.conflicts.length) {
        new Notice(
          `LYTEX OS: ${msg(`${report.recovery.replayed} unterbrochene Schreibvorgänge abgeschlossen`, `${report.recovery.replayed} interrupted writes completed`)}${report.recovery.conflicts.length ? `, ${report.recovery.conflicts.length} ${msg('Konflikte (siehe Datenprüfung)', 'conflicts (see data health)')}` : ''}.`,
          10000,
        );
      }
      if (report.recurring?.created.length)
        new Notice(
          `LYTEX OS: ${t('recurring.reconciled', { n: report.recurring.created.length })}`,
        );
      const errors = core.index.issues().filter((i) => i.severity === 'error').length;
      if (errors) new Notice(`LYTEX OS: ${t('dash.dataIssues', { n: errors })}`, 8000);
      if (core.timer.stateName === 'recovering') this.openRecovery();
    } catch (e) {
      console.error('[LYTEX OS] initialisation failed', e);
      new Notice(
        msg(
          `LYTEX OS: Initialisierung fehlgeschlagen – ${errorMessage(e)}`,
          `LYTEX OS: initialisation failed – ${errorMessage(e)}`,
        ),
        15000,
      );
    }
  }

  /** One-time data migrations tied to settings upgrades (recorded in settings.dataMigrations). */
  private async runDataMigrations(core: OpsCore): Promise<void> {
    if (this.settings.dataMigrations.includes('assignees-v2')) return;
    try {
      const n = await migrateLegacyAssignees(core.ctx, this.settings.me);
      this.settings.dataMigrations.push('assignees-v2');
      await this.saveData(this.settings);
      if (n)
        new Notice(
          msg(
            `LYTEX OS: ${n} Tickets auf Mehrfach-Zuordnung umgestellt („LYTEX“ → ${this.settings.me}).`,
            `LYTEX OS: ${n} tickets converted to multiple assignees (“LYTEX” → ${this.settings.me}).`,
          ),
        );
    } catch (e) {
      console.error('[LYTEX OS] data migration', e);
      new Notice(
        msg(
          `LYTEX OS: Migration der Zuordnungen fehlgeschlagen – ${errorMessage(e)}`,
          `LYTEX OS: migrating assignees failed – ${errorMessage(e)}`,
        ),
        10000,
      );
    }
  }

  private bumpVersion(): void {
    if (this.versionTimer) return;
    this.versionTimer = window.setTimeout(() => {
      this.versionTimer = null;
      this.version.update((v) => v + 1);
    }, 120);
  }

  async setupStructure(overwriteConfig: boolean, core: OpsCore | null = this.core): Promise<void> {
    if (!core) return;
    await core.ensureStructure();
    await writeOverviewNotes(this.files, this.settings, overwriteConfig);
    if (overwriteConfig)
      new Notice(msg('LYTEX OS: Ordnerstruktur angelegt', 'LYTEX OS: folder structure created'));
  }

  async rebuild(): Promise<void> {
    if (!this.core) return;
    const t0 = performance.now();
    this.indexedRoot = this.settings.rootFolder;
    const n = await this.core.rebuildIndex(
      (p) => this.files.cachedRead(p),
      (p) => this.cachedFrontmatter(p),
    );
    new Notice(
      msg(
        `LYTEX OS: ${n} Dateien in ${Math.round(performance.now() - t0)} ms indexiert`,
        `LYTEX OS: ${n} files indexed in ${Math.round(performance.now() - t0)} ms`,
      ),
    );
  }

  /** Frontmatter already parsed by Obsidian (fast path for index builds). */
  private cachedFrontmatter(path: string): Record<string, unknown> | undefined {
    const file = this.app.vault.getFileByPath(path);
    const fm = file ? this.app.metadataCache.getFileCache(file)?.frontmatter : undefined;
    return fm && typeof fm === 'object' ? (fm as Record<string, unknown>) : undefined;
  }

  private isEntityPath(path: string): boolean {
    return !!this.core && path.endsWith('.md') && this.core.isInRoot(path);
  }

  private registerVaultEvents(): void {
    const reindex = async (file: TAbstractFile) => {
      if (!(file instanceof TFile) || !this.isEntityPath(file.path) || !this.core) return;
      const content = await this.app.vault.cachedRead(file);
      this.core.index.upsert(file.path, content);
    };
    this.registerEvent(this.app.vault.on('create', (f) => void reindex(f)));
    this.registerEvent(this.app.vault.on('modify', (f) => void reindex(f)));
    this.registerEvent(this.app.metadataCache.on('changed', (f) => void reindex(f)));
    this.registerEvent(
      this.app.vault.on('delete', (f) => {
        if (this.core && f instanceof TFile && this.core.isInRoot(f.path))
          this.core.index.remove(f.path);
      }),
    );
    this.registerEvent(
      this.app.vault.on('rename', (f, oldPath) => {
        if (!this.core || !(f instanceof TFile)) return;
        if (this.core.isInRoot(oldPath)) this.core.index.remove(oldPath);
        void reindex(f);
      }),
    );
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu: Menu, file: TAbstractFile) => {
        if (!this.core || !(file instanceof TFile)) return;
        const rec = this.core.index.recordAt(file.path);
        if (!rec) return;
        const e = rec.entity;
        menu.addItem((i) =>
          i
            .setTitle(`${t('app.short')}: ${t('common.open')}`)
            .setIcon('briefcase')
            .onClick(() => void this.openEntity(e.id)),
        );
        if (e.type === 'ticket' || e.type === 'project') {
          menu.addItem((i) =>
            i
              .setTitle(`${t('app.short')}: ${t('ticket.startTimer')}`)
              .setIcon('play')
              .onClick(
                () =>
                  void this.api?.startTimer(
                    e.type === 'ticket'
                      ? { project_id: e.project_id, ticket_id: e.id, billable: e.billable }
                      : { project_id: e.id },
                  ),
              ),
          );
        }
      }),
    );
  }

  private registerTimerLoops(): void {
    const core = this.core!;
    const hb = this.settings.timer.heartbeatSeconds * 1000;
    this.registerInterval(
      window.setInterval(
        () => void core.timer.heartbeat().catch((e) => console.error('[LYTEX OS] heartbeat', e)),
        hb,
      ),
    );
    this.registerInterval(window.setInterval(() => this.updateStatusBar(), 1000));
    // Run a heartbeat immediately when the window regains focus (detects suspend quickly).
    this.registerDomEvent(window, 'focus', () => void core.timer.heartbeat());
    this.registerDomEvent(document, 'visibilitychange', () => {
      if (document.visibilityState === 'visible') void core.timer.heartbeat();
    });
    // Daily reconciliation of recurring work while Obsidian stays open across midnight.
    this.registerInterval(
      window.setInterval(() => {
        const day = localDate(Date.now());
        if (day !== this.lastReconcileDay) {
          this.lastReconcileDay = day;
          void reconcileRecurring(core.ctx).then(
            (r) =>
              r.created.length &&
              new Notice(`LYTEX OS: ${t('recurring.reconciled', { n: r.created.length })}`),
          );
        }
      }, 10 * 60_000),
    );
  }

  updateStatusBar(): void {
    if (!this.statusEl) return;
    const s = this.core?.timer.session ?? null;
    if (!this.settings.timer.showStatusBar || !s) {
      this.statusEl.setText(this.settings.timer.showStatusBar ? '◷ —' : '');
      this.statusEl.toggleClass('lx-running', false);
      return;
    }
    const elapsed = formatDuration(sessionElapsedSeconds(s, Date.now()), true);
    const ticket = this.core?.index.get('ticket', s.ticket_id);
    const proj = this.core?.index.get('project', s.project_id);
    const icon = s.state === 'running' ? '●' : s.state === 'paused' ? '⏸' : '⚠';
    this.statusEl.setText(`${icon} ${elapsed} ${ticket?.ticket_number ?? proj?.key ?? ''}`);
    this.statusEl.toggleClass('lx-running', s.state === 'running');
    this.statusEl.setAttr('aria-label', `${proj?.name ?? ''} ${ticket?.title ?? ''}`.trim());
  }

  rerenderViews(): void {
    for (const type of [VIEW_MAIN, VIEW_TIMER]) {
      for (const leaf of this.app.workspace.getLeavesOfType(type)) {
        const v = leaf.view;
        if (v instanceof MainView || v instanceof TimerView) v.render();
      }
    }
  }

  async activateMain(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_MAIN)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getLeaf('tab');
      await leaf.setViewState({ type: VIEW_MAIN, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  async activateTimer(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TIMER)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      if (!leaf) return;
      await leaf.setViewState({ type: VIEW_TIMER, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  async openEntity(id: string): Promise<void> {
    const core = this.core;
    const rec = core?.index.record(id);
    if (!rec) return;
    const route = {
      customer: 'customer',
      project: 'project',
      ticket: 'ticket',
      billing_batch: 'batch',
      quote: 'quote',
    } as const;
    const name = route[rec.entity.type as keyof typeof route];
    await this.activateMain();
    if (name) this.router.go({ name, id });
    else if (rec.entity.type === 'contact' || rec.entity.type === 'interaction')
      this.router.go({ name: 'customer', id: rec.entity.customer_id });
    else if (rec.entity.type === 'time_entry') this.router.go({ name: 'time' });
    else if (rec.entity.type === 'expense') this.router.go({ name: 'expenses' });
    else if (rec.entity.type === 'recurring_task') this.router.go({ name: 'recurring' });
    else this.router.go({ name: 'services' });
  }

  openRecovery(): void {
    if (this.recoveryOpen || !this.api) return;
    this.recoveryOpen = true;
    new SvelteModal(
      this.app,
      RecoveryForm as unknown as Component<{ api: UiApi } & { close: () => void }>,
      { api: this.api },
      t('timer.recovery.title'),
      false,
      () => (this.recoveryOpen = false),
    ).open();
  }

  private openForm(req: FormRequest): void {
    if (!this.api) {
      new Notice(t('app.notReady'));
      return;
    }
    const def = FORMS[req.kind];
    const props: Record<string, unknown> = { api: this.api, id: req.id, preset: req.preset ?? {} };
    if (req.kind === 'invoice' || req.kind === 'payment') props['mode'] = req.kind;
    new SvelteModal(
      this.app,
      def.component as unknown as Component<Record<string, unknown> & { close: () => void }>,
      props,
      def.title(!!req.id),
      def.wide,
    ).open();
  }

  private confirm(title: string, message: string, label = t('common.confirm')): Promise<boolean> {
    return new Promise((resolve) =>
      new ConfirmModal(this.app, title, message, label, t('common.cancel'), resolve).open(),
    );
  }

  private pick(
    type: 'customer' | 'project' | 'ticket',
    placeholder = t('common.search'),
  ): Promise<string | null> {
    const core = this.core;
    if (!core) return Promise.resolve(null);
    const items =
      type === 'customer'
        ? core.index
            .all('customer')
            .filter((c) => !c.archived)
            .map((c) => ({ id: c.id, label: `${c.customer_number} ${c.name}` }))
        : type === 'project'
          ? core.index
              .all('project')
              .filter((p) => !p.archived && p.status !== 'completed' && p.status !== 'cancelled')
              .map((p) => ({
                id: p.id,
                label: `${p.project_number} ${p.name} · ${core.index.get('customer', p.customer_id)?.name ?? t('common.internal')}`,
              }))
          : core.index
              .all('ticket')
              .filter((x) => !x.archived && x.completed_at === null)
              .map((x) => ({
                id: x.id,
                label: `${x.ticket_number} ${x.title} · ${core.index.get('project', x.project_id)?.name ?? ''}`,
              }));
    return new Promise((resolve) =>
      new EntityPickerModal(this.app, items, placeholder, resolve).open(),
    );
  }

  private buildApi(core: OpsCore): UiApi {
    const now: Readable<number> = readable(Date.now(), (set) => {
      const h = window.setInterval(() => set(Date.now()), 1000);
      return () => window.clearInterval(h);
    });
    const notify = (message: string, kind: 'info' | 'success' | 'error' = 'info') =>
      new Notice(kind === 'error' ? `⚠ ${message}` : message, kind === 'error' ? 8000 : 4000);
    const api: UiApi = {
      core,
      ctx: core.ctx,
      settings: () => this.settings,
      version: { subscribe: this.version.subscribe },
      timer: { subscribe: this.timerStore.subscribe },
      now,
      router: this.router,
      openNote: (idOrPath, newLeaf = false) => {
        const path = core.index.pathOf(idOrPath) ?? idOrPath;
        const file =
          this.app.vault.getFileByPath(path) ??
          this.app.metadataCache.getFirstLinkpathDest(path, '');
        if (!file) {
          notify(msg(`Datei nicht gefunden: ${path}`, `File not found: ${path}`), 'error');
          return;
        }
        void this.app.workspace.getLeaf(newLeaf ? 'split' : 'tab').openFile(file);
      },
      notify,
      confirm: (title, message, label) => this.confirm(title, message, label),
      run: async (fn, success) => {
        try {
          const r = await fn();
          if (success) notify(success, 'success');
          return r;
        } catch (e) {
          console.error('[LYTEX OS]', e);
          notify(errorMessage(e), 'error');
          return undefined;
        }
      },
      openForm: (req) => this.openForm(req),
      startTimer: async (ctx) => {
        const timer = core.timer;
        if (timer.session) {
          if (
            timer.session.project_id === ctx.project_id &&
            timer.session.ticket_id === (ctx.ticket_id ?? null) &&
            timer.stateName === 'paused'
          ) {
            await api.run(() => timer.resume());
            return;
          }
          if (!(await this.confirm(t('timer.title'), t('timer.alreadyRunning')))) return;
          await api.stopTimer();
          if (timer.session) return;
        }
        const project = core.index.get('project', ctx.project_id);
        const full: TimerContext = {
          project_id: ctx.project_id,
          ticket_id: ctx.ticket_id ?? null,
          customer_id: project?.customer_id ?? null,
          service_id: ctx.service_id ?? null,
          description: ctx.description ?? '',
          billable: project?.billing_model === 'internal' ? false : (ctx.billable ?? true),
        };
        const started = await api.run(() => timer.start(full));
        if (started)
          notify(`▶ ${core.index.get('ticket', full.ticket_id)?.title ?? project?.name ?? ''}`);
      },
      stopTimer: async () => {
        const timer = core.timer;
        if (timer.stateName === 'recovering') {
          this.openRecovery();
          return;
        }
        let r = await api.run(() => timer.stop());
        if (r?.kind === 'too_short') {
          if (
            !(await this.confirm(
              t('timer.title'),
              t('timer.tooShort', { d: formatDuration(r.durationSeconds, true) }),
              t('common.save'),
            ))
          )
            return;
          r = await api.run(() => timer.stop({ allowShort: true }));
        }
        if (r?.kind === 'committed')
          notify(t('timer.saved', { d: formatDuration(r.durationSeconds) }), 'success');
      },
      openTimerPanel: () => void this.activateTimer(),
      openRecovery: () => this.openRecovery(),
      pickEntity: (type, placeholder) => this.pick(type, placeholder),
      saveSettings: () => this.saveSettings(),
      renderMarkdown: async (el, markdown, sourcePath) => {
        el.empty();
        const owner = new ObsidianComponent();
        owner.load();
        await MarkdownRenderer.render(this.app, markdown, el, sourcePath, owner);
        return () => owner.unload();
      },
      saveAttachment: (projectId, file) => this.saveAttachment(core, projectId, file),
      secrets: this.secretsApi(),
      openPluginSettings: () => this.openPluginSettings(),
    };
    return api;
  }

  /** Store an image in `<project folder>/Attachments/` with a unique, safe file name. */
  private async saveAttachment(core: OpsCore, projectId: string, file: File): Promise<string> {
    const folder = core.paths.projectFolder(projectId);
    if (!folder) throw new Error(msg('Projektordner nicht gefunden', 'Project folder not found'));
    const dir = normalizePath(`${folder}/Attachments`);
    await this.files.ensureFolder(dir);
    const dot = file.name.lastIndexOf('.');
    const ext = (dot > 0 ? file.name.slice(dot + 1) : (file.type.split('/')[1] ?? 'png'))
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    const base = safeFileName(dot > 0 ? file.name.slice(0, dot) : msg('Bild', 'Image'), 60).replace(
      /\s+/g,
      '-',
    );
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
    let path = normalizePath(`${dir}/${stamp}-${base}.${ext || 'png'}`);
    for (let i = 2; this.app.vault.getAbstractFileByPath(path); i++)
      path = normalizePath(`${dir}/${stamp}-${base}-${i}.${ext || 'png'}`);
    await this.app.vault.createBinary(path, await file.arrayBuffer());
    return path;
  }

  /** API keys live in Obsidian's Keychain (app.secretStorage, Obsidian ≥ 1.11.4). */
  private secretsApi(): UiApi['secrets'] {
    const store = (
      this.app as {
        secretStorage?: {
          getSecret(id: string): string | null;
          setSecret(id: string, v: string): void;
        };
      }
    ).secretStorage;
    const get = (id: SecretId) => store?.getSecret(id) ?? '';
    return {
      available: !!store,
      has: (id) => get(id).length > 0,
      hint: (id) => {
        const v = get(id);
        return v.length > 8 ? `…${v.slice(-4)}` : '••••';
      },
      set: (id, value) => store?.setSecret(id, value),
      clear: (id) => store?.setSecret(id, ''),
    };
  }

  /** Opens Obsidian's settings on this plugin's tab (no official API → guarded). */
  private openPluginSettings(): void {
    const setting = (this.app as { setting?: { open(): void; openTabById(id: string): void } })
      .setting;
    if (!setting) {
      new Notice(
        msg(
          'Einstellungen → Community-Plugins → LYTEX Operations OS',
          'Settings → Community plugins → LYTEX Operations OS',
        ),
      );
      return;
    }
    setting.open();
    setting.openTabById(this.manifest.id);
  }

  private registerCommands(): void {
    const withApi = (fn: (api: UiApi) => unknown) => () => {
      if (!this.api) {
        new Notice(t('app.notReady'));
        return;
      }
      void fn(this.api);
    };
    this.addCommand({
      id: 'open-dashboard',
      name: msg('Dashboard öffnen', 'Open dashboard'),
      callback: () => void this.activateMain().then(() => this.router.go({ name: 'dashboard' })),
    });
    this.addCommand({
      id: 'open-timer',
      name: msg('Timer-Seitenleiste öffnen', 'Open timer sidebar'),
      callback: () => void this.activateTimer(),
    });
    this.addCommand({
      id: 'open-my-work',
      name: msg('Meine Arbeit öffnen', 'Open my work'),
      callback: () =>
        void this.activateMain().then(() =>
          this.router.go({ name: 'tickets', params: { preset: 'mine' } }),
        ),
    });
    this.addCommand({
      id: 'open-billing',
      name: msg('Abrechnung öffnen', 'Open billing'),
      callback: () => void this.activateMain().then(() => this.router.go({ name: 'billing' })),
    });
    this.addCommand({
      id: 'open-timesheet',
      name: msg('Zeiterfassung öffnen', 'Open time tracking'),
      callback: () => void this.activateMain().then(() => this.router.go({ name: 'time' })),
    });
    this.addCommand({
      id: 'open-health',
      name: msg('Datenprüfung öffnen', 'Open data health'),
      callback: () => void this.activateMain().then(() => this.router.go({ name: 'health' })),
    });
    this.addCommand({
      id: 'timer-start-ticket',
      name: msg('Timer für Ticket starten …', 'Start timer for ticket…'),
      callback: withApi(async (api) => {
        const id = await api.pickEntity('ticket', msg('Ticket wählen …', 'Choose ticket…'));
        const tk = id ? api.ctx.index.get('ticket', id) : undefined;
        if (tk)
          await api.startTimer({
            project_id: tk.project_id,
            ticket_id: tk.id,
            billable: tk.billable,
          });
      }),
    });
    this.addCommand({
      id: 'timer-start-project',
      name: msg('Timer für Projekt starten …', 'Start timer for project…'),
      callback: withApi(async (api) => {
        const id = await api.pickEntity('project', msg('Projekt wählen …', 'Choose project…'));
        if (id) await api.startTimer({ project_id: id });
      }),
    });
    this.addCommand({
      id: 'timer-start-current',
      name: msg('Timer für aktuelle Notiz starten', 'Start timer for current note'),
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const e = file && this.core ? this.core.index.recordAt(file.path)?.entity : undefined;
        if (!e || (e.type !== 'ticket' && e.type !== 'project')) return false;
        if (!checking)
          void this.api?.startTimer(
            e.type === 'ticket'
              ? { project_id: e.project_id, ticket_id: e.id, billable: e.billable }
              : { project_id: e.id },
          );
        return true;
      },
    });
    this.addCommand({
      id: 'timer-toggle-pause',
      name: msg('Timer pausieren/fortsetzen', 'Pause/resume timer'),
      checkCallback: (checking) => {
        const st = this.core?.timer.stateName;
        if (st !== 'running' && st !== 'paused') return false;
        if (!checking)
          void this.api?.run(() =>
            st === 'running' ? this.core!.timer.pause() : this.core!.timer.resume(),
          );
        return true;
      },
    });
    this.addCommand({
      id: 'timer-stop',
      name: msg('Timer stoppen & speichern', 'Stop and save timer'),
      checkCallback: (checking) => {
        if (!this.core?.timer.session) return false;
        if (!checking) void this.api?.stopTimer();
        return true;
      },
    });
    this.addCommand({
      id: 'timer-discard',
      name: msg('Timer verwerfen', 'Discard timer'),
      checkCallback: (checking) => {
        if (!this.core?.timer.session) return false;
        if (!checking)
          void this.confirm(t('timer.discard'), t('timer.discardConfirm'), t('timer.discard')).then(
            (ok) => {
              if (ok) void this.api?.run(() => this.core!.timer.discard());
            },
          );
        return true;
      },
    });
    for (const [kind, name] of [
      ['customer', msg('Neuer Kunde', 'New customer')],
      ['project', msg('Neues Projekt', 'New project')],
      ['ticket', msg('Neues Ticket', 'New ticket')],
      ['time', msg('Zeit manuell erfassen', 'Add time entry')],
      ['expense', msg('Neue Ausgabe', 'New expense')],
      ['quote', msg('Neues Angebot', 'New quote')],
      ['interaction', msg('Kundenkontakt erfassen', 'Log customer interaction')],
    ] as const) {
      this.addCommand({
        id: `new-${kind}`,
        name,
        callback: withApi((api) => api.openForm({ kind })),
      });
    }
    this.addCommand({
      id: 'open-entity',
      name: msg('Kunde/Projekt öffnen …', 'Open project…'),
      callback: withApi(async (api) => {
        const id =
          (await api.pickEntity('project', msg('Projekt wählen …', 'Choose project…'))) ?? null;
        if (id) await this.openEntity(id);
      }),
    });
    this.addCommand({
      id: 'open-current-entity',
      name: msg('Aktuelle Notiz in LYTEX OS öffnen', 'Open current note in LYTEX OS'),
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const rec = file && this.core ? this.core.index.recordAt(file.path) : undefined;
        if (!rec) return false;
        if (!checking) void this.openEntity(rec.entity.id);
        return true;
      },
    });
    this.addCommand({
      id: 'rebuild-index',
      name: msg('Index neu aufbauen', 'Rebuild index'),
      callback: () => void this.rebuild(),
    });
    this.addCommand({
      id: 'reconcile-recurring',
      name: msg('Wiederkehrende Aufgaben abgleichen', 'Reconcile recurring tasks'),
      callback: withApi(async (api) => {
        const r = await api.run(() => reconcileRecurring(api.ctx));
        if (r) api.notify(t('recurring.reconciled', { n: r.created.length }), 'success');
      }),
    });
    this.addCommand({
      id: 'setup-structure',
      name: msg('Ordnerstruktur anlegen', 'Create folder structure'),
      callback: () => void this.setupStructure(true),
    });
  }
}
