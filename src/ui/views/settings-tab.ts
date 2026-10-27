import { PluginSettingTab, Setting, type App, type TextComponent } from 'obsidian';
import type LytexOpsPlugin from '../../main';
import { t } from '@/shared/i18n';
import { parseMoney } from '@/shared/money/money';
import {
  validateWorkflow,
  type StatusCategory,
  type WorkflowStatus,
} from '@/domain/policies/workflow';
import { centsToInput } from '../forms/form-utils';
import { msg } from '@/shared/i18n';

export class LytexSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: LytexOpsPlugin,
  ) {
    super(app, plugin);
  }

  override display(): void {
    const { containerEl } = this;
    const s = this.plugin.settings;
    const save = async () => this.plugin.saveSettings();
    let rootInput: TextComponent | null = null;
    containerEl.empty();

    new Setting(containerEl).setName(t('settings.general')).setHeading();
    new Setting(containerEl)
      .setName(t('settings.root'))
      .setDesc(
        t('settings.rootDesc') +
          msg(
            ' Nach Änderung wird der Index neu aufgebaut; vorhandene Dateien werden nicht verschoben.',
            ' After a change the index is rebuilt; existing files are not moved.',
          ),
      )
      .addText((tx) => {
        rootInput = tx;
        tx.setValue(s.rootFolder);
      })
      .addButton((b) =>
        b
          .setButtonText(t('settings.rootApply'))
          .setCta()
          .onClick(async () => {
            // Applied explicitly (not per keystroke) so partial input never creates folders.
            const clean = (rootInput?.getValue() ?? '').trim().replace(/^\/+|\/+$/g, '');
            if (!clean || /\.\.|(^|\/)\./.test(clean)) {
              rootInput?.inputEl.addClass('lx-invalid');
              return;
            }
            rootInput?.inputEl.removeClass('lx-invalid');
            if (clean === s.rootFolder) return;
            s.rootFolder = clean;
            await save();
          }),
      )
      .addButton((b) =>
        b.setButtonText(t('health.rebuild')).onClick(() => void this.plugin.rebuild()),
      );
    new Setting(containerEl)
      .setName(t('settings.setup'))
      .setDesc(t('settings.setupDesc'))
      .addButton((b) =>
        b.setButtonText(t('settings.setup')).onClick(() => void this.plugin.setupStructure(true)),
      );
    new Setting(containerEl).setName(t('settings.locale')).addDropdown((d) =>
      d
        .addOptions({ auto: t('settings.locale.auto'), de: 'Deutsch', en: 'English' })
        .setValue(s.locale)
        .onChange(async (v) => {
          s.locale = v as 'auto' | 'de' | 'en';
          await save();
          this.plugin.rerenderViews();
          this.display();
        }),
    );

    new Setting(containerEl)
      .setName(`${t('settings.appearance')}, ${t('settings.team')}, ${t('settings.integrations')}`)
      .setDesc(
        msg(
          'Akzentfarbe, Team-Liste und API-Schlüssel: in LYTEX OS unter „Einstellungen“ (Navigation unten links).',
          'Accent colour, team and API keys: in LYTEX OS under “Settings” (navigation, bottom left).',
        ),
      );

    new Setting(containerEl).setName(t('settings.rates')).setHeading();
    const moneySetting = (
      name: string,
      get: () => number | null,
      set: (v: number | null) => void,
      nullable = false,
    ) =>
      new Setting(containerEl).setName(name).addText((tx) =>
        tx.setValue(centsToInput(get())).onChange(async (v) => {
          if (nullable && !v.trim()) {
            set(null);
            await save();
            return;
          }
          const c = parseMoney(v);
          if (c === null || c < 0) {
            tx.inputEl.addClass('lx-invalid');
            return;
          }
          tx.inputEl.removeClass('lx-invalid');
          set(c);
          await save();
        }),
      );
    moneySetting(
      t('settings.defaultRate'),
      () => s.defaultHourlyRateCents,
      (v) => (s.defaultHourlyRateCents = v ?? 0),
    );
    moneySetting(
      t('settings.dailyRate'),
      () => s.defaultDailyRateCents,
      (v) => (s.defaultDailyRateCents = v ?? 0),
    );
    moneySetting(
      t('settings.costRate'),
      () => s.internalCostRateCents,
      (v) => (s.internalCostRateCents = v),
      true,
    );
    new Setting(containerEl).setName(t('settings.standardDay')).addText((tx) =>
      tx.setValue(String(s.standardDaySeconds / 3600)).onChange(async (v) => {
        const h = Number(v.replace(',', '.'));
        if (h > 0 && h <= 24) {
          s.standardDaySeconds = Math.round(h * 3600);
          await save();
        }
      }),
    );
    new Setting(containerEl)
      .setName(t('settings.rounding'))
      .setDesc(
        msg(
          'Wird je Zeiteintrag beim Erstellen eines Abrechnungslaufs angewandt und im Lauf dokumentiert.',
          'Applied per time entry when a billing batch is created, and documented in the batch.',
        ),
      )
      .addDropdown((d) =>
        d
          .addOptions({
            none: msg('Keine', 'None'),
            up: msg('Aufrunden', 'Round up'),
            nearest: msg('Kaufmännisch', 'Nearest'),
            down: msg('Abrunden', 'Round down'),
          })
          .setValue(s.rounding.mode)
          .onChange(async (v) => ((s.rounding.mode = v as typeof s.rounding.mode), await save())),
      )
      .addDropdown((d) =>
        d
          .addOptions({
            '1': '1 min',
            '5': '5 min',
            '6': '6 min',
            '10': '10 min',
            '15': '15 min',
            '30': '30 min',
            '60': '60 min',
          })
          .setValue(String(s.rounding.unit_minutes))
          .onChange(async (v) => ((s.rounding.unit_minutes = Number(v)), await save())),
      );
    new Setting(containerEl).setName(t('settings.csv')).addDropdown((d) =>
      d
        .addOptions({
          ';': msg('Semikolon (;)', 'Semicolon (;)'),
          ',': msg('Komma (,)', 'Comma (,)'),
          '\t': msg('Tabulator', 'Tab'),
        })
        .setValue(s.csv.delimiter)
        .onChange(async (v) => ((s.csv.delimiter = v as typeof s.csv.delimiter), await save())),
    );
    new Setting(containerEl).setName(t('settings.decimal')).addDropdown((d) =>
      d
        .addOptions({
          ',': msg('Komma (1234,56)', 'Comma (1234,56)'),
          '.': msg('Punkt (1234.56)', 'Point (1234.56)'),
        })
        .setValue(s.csv.decimalSeparator)
        .onChange(async (v) => ((s.csv.decimalSeparator = v as ',' | '.'), await save())),
    );
    new Setting(containerEl).setName(t('settings.thresholds')).addText((tx) =>
      tx.setValue(s.budgetThresholds.join(', ')).onChange(async (v) => {
        const list = v
          .split(',')
          .map((x) => Number(x.trim()))
          .filter((x) => Number.isFinite(x) && x > 0 && x <= 1000);
        if (list.length) {
          s.budgetThresholds = list;
          await save();
        }
      }),
    );

    new Setting(containerEl).setName(t('settings.workflow')).setHeading();
    new Setting(containerEl)
      .setName(t('settings.workflow'))
      .setDesc(t('settings.workflowDesc'))
      .addTextArea((ta) => {
        ta.inputEl.rows = 8;
        ta.inputEl.addClass('lx-settings-textarea');
        ta.setValue(s.workflow.map((w) => `${w.key} | ${w.label} | ${w.category}`).join('\n'));
        ta.onChange(async (v) => {
          const wf: WorkflowStatus[] = v
            .split('\n')
            .map((l) => l.split('|').map((x) => x.trim()))
            .filter((p) => p.length === 3 && p[0])
            .map(([key, label, category]) => ({
              key: key!,
              label: label!,
              category: category as StatusCategory,
            }));
          const errs = validateWorkflow(wf);
          if (
            wf.some((w) => !['open', 'active', 'blocked', 'done', 'cancelled'].includes(w.category))
          )
            errs.push(msg('Ungültige Kategorie', 'Invalid category'));
          if (errs.length) {
            ta.inputEl.addClass('lx-invalid');
            ta.inputEl.title = errs.join('\n');
            return;
          }
          ta.inputEl.removeClass('lx-invalid');
          ta.inputEl.title = '';
          s.workflow = wf;
          await save();
        });
      });
    new Setting(containerEl).setName(t('settings.categories')).addText((tx) =>
      tx.setValue(s.ticketCategories.join(', ')).onChange(
        async (v) => (
          (s.ticketCategories = v
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean)),
          await save()
        ),
      ),
    );
    new Setting(containerEl).setName(t('settings.expenseCategories')).addText((tx) =>
      tx.setValue(s.expenseCategories.join(', ')).onChange(
        async (v) => (
          (s.expenseCategories = v
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean)),
          await save()
        ),
      ),
    );
    new Setting(containerEl).setName(t('settings.dod')).setHeading();
    new Setting(containerEl).setName(t('settings.dodChecklist')).addDropdown((d) =>
      d
        .addOptions({
          none: msg('Keine Prüfung', 'No check'),
          required_items: msg('Pflichtpunkte erledigt', 'Required items done'),
          all_items: msg('Alle Punkte erledigt', 'All items done'),
        })
        .setValue(s.doneRules.requireChecklistComplete)
        .onChange(
          async (v) => (
            (s.doneRules.requireChecklistComplete =
              v as typeof s.doneRules.requireChecklistComplete),
            await save()
          ),
        ),
    );
    new Setting(containerEl)
      .setName(t('settings.dodDeps'))
      .addToggle((tg) =>
        tg
          .setValue(s.doneRules.requireDependenciesResolved)
          .onChange(async (v) => ((s.doneRules.requireDependenciesResolved = v), await save())),
      );
    new Setting(containerEl)
      .setName(t('settings.dodEstimate'))
      .addToggle((tg) =>
        tg
          .setValue(s.doneRules.requireEstimate)
          .onChange(async (v) => ((s.doneRules.requireEstimate = v), await save())),
      );
    new Setting(containerEl)
      .setName(t('settings.dodTracked'))
      .addToggle((tg) =>
        tg
          .setValue(s.doneRules.requireTrackedTime)
          .onChange(async (v) => ((s.doneRules.requireTrackedTime = v), await save())),
      );

    new Setting(containerEl).setName(t('settings.timer')).setHeading();
    new Setting(containerEl).setName(t('settings.minEntry')).addText((tx) =>
      tx.setValue(String(s.timer.minEntrySeconds)).onChange(async (v) => {
        const n = Number(v);
        if (Number.isInteger(n) && n >= 0 && n <= 3600) {
          s.timer.minEntrySeconds = n;
          await save();
        }
      }),
    );
    new Setting(containerEl)
      .setName(t('settings.stale'))
      .setDesc(
        msg(
          'Lief der Timer länger ohne Lebenszeichen (Absturz, Neustart, Ruhezustand), wird beim nächsten Start nachgefragt. Wirksam nach Neuladen des Plugins.',
          'If the timer ran without a sign of life (crash, restart, sleep), you are asked on the next start. Takes effect after reloading the plugin.',
        ),
      )
      .addText((tx) =>
        tx.setValue(String(s.timer.staleAfterMinutes)).onChange(async (v) => {
          const n = Number(v);
          if (n >= 1 && n <= 120) {
            s.timer.staleAfterMinutes = n;
            await save();
          }
        }),
      );
    new Setting(containerEl)
      .setName(t('settings.statusBar'))
      .addToggle((tg) =>
        tg
          .setValue(s.timer.showStatusBar)
          .onChange(
            async (v) => ((s.timer.showStatusBar = v), await save(), this.plugin.updateStatusBar()),
          ),
      );
    new Setting(containerEl).setName(t('settings.overlap')).addDropdown((d) =>
      d
        .addOptions({ warn: t('settings.overlap.warn'), block: t('settings.overlap.block') })
        .setValue(s.overlapPolicy)
        .onChange(async (v) => ((s.overlapPolicy = v as 'warn' | 'block'), await save())),
    );

    new Setting(containerEl)
      .setName('Backup & Export')
      .setDesc(
        msg(
          'Alle Daten liegen als Markdown im Stammordner. Für ein Backup genügt eine Kopie des Vaults inkl. .obsidian/plugins/lytex-operations-os/state.',
          'All data are Markdown notes in the root folder. For a backup, copy the vault incl. .obsidian/plugins/lytex-operations-os/state.',
        ),
      );
  }
}
