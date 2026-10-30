import {
  DEFAULT_DONE_RULES,
  DEFAULT_WORKFLOW,
  LEGACY_DEFAULT_WORKFLOW_KEYS,
  type DoneRules,
  type WorkflowStatus,
} from '@/domain/policies/workflow';
import type { RoundingRule } from '@/domain/services/rounding';
import { msg } from '@/shared/i18n';

/** UI language; 'auto' follows Obsidian's language. */
export type Locale = 'auto' | 'de' | 'en';

export const SETTINGS_VERSION = 2;

export const DEFAULT_ACCENT = '#013e37';

export interface LytexSettings {
  settingsVersion: number;
  rootFolder: string;
  locale: Locale;
  currency: 'EUR' | 'CHF' | 'USD' | 'GBP';
  defaultHourlyRateCents: number;
  defaultDailyRateCents: number;
  standardDaySeconds: number;
  /** Internal cost per hour for profitability; null = not tracked. */
  internalCostRateCents: number | null;
  rounding: RoundingRule;
  workflow: WorkflowStatus[];
  doneRules: DoneRules;
  ticketCategories: string[];
  expenseCategories: string[];
  budgetThresholds: number[];
  dueSoonDays: number;
  /** Tickets done for this many days are archived automatically (0 = never). */
  autoArchiveDoneDays: number;
  /** People that can be assigned to tickets. */
  team: string[];
  /** The plugin owner – "Meine Arbeit" shows tickets assigned to this person. */
  me: string;
  /** Pre-selected assignee for new tickets. */
  defaultAssignee: string;
  /** Brand/accent colour of the UI (hex). */
  accentColor: string;
  /** One-time data migrations already performed. */
  dataMigrations: string[];
  timer: {
    heartbeatSeconds: number;
    staleAfterMinutes: number;
    minEntrySeconds: number;
    showStatusBar: boolean;
  };
  overlapPolicy: 'warn' | 'block';
  csv: { delimiter: ';' | ',' | '\t'; decimalSeparator: ',' | '.' };
  recurringLeadDays: number;
  integrations: { lexwareOffice: { enabled: boolean } };
  /** Set once the default folder structure has been created. */
  initialized: boolean;
}

export const DEFAULT_SETTINGS: LytexSettings = {
  settingsVersion: SETTINGS_VERSION,
  rootFolder: 'LYTEX OS',
  locale: 'auto',
  currency: 'EUR',
  defaultHourlyRateCents: 7000,
  defaultDailyRateCents: 55000,
  standardDaySeconds: 8 * 3600,
  internalCostRateCents: null,
  rounding: { unit_minutes: 15, mode: 'none' },
  workflow: DEFAULT_WORKFLOW,
  doneRules: DEFAULT_DONE_RULES,
  ticketCategories: ['Entwicklung', 'Bugfix', 'Support', 'Wartung', 'Beratung', 'Administration'],
  expenseCategories: ['Hardware', 'Software/Lizenzen', 'Hosting', 'Reise', 'Material', 'Sonstiges'],
  budgetThresholds: [50, 75, 90, 100],
  dueSoonDays: 7,
  autoArchiveDoneDays: 30,
  // Filled in by the user on first start (Einstellungen → Team); no personal defaults.
  team: [],
  me: '',
  defaultAssignee: '',
  accentColor: DEFAULT_ACCENT,
  dataMigrations: [],
  timer: { heartbeatSeconds: 15, staleAfterMinutes: 2, minEntrySeconds: 60, showStatusBar: true },
  overlapPolicy: 'warn',
  csv: { delimiter: ';', decimalSeparator: ',' },
  recurringLeadDays: 7,
  integrations: { lexwareOffice: { enabled: false } },
  initialized: false,
};

/** Merge persisted settings with defaults; tolerant against missing or malformed fields. */
export function mergeSettings(raw: unknown): LytexSettings {
  const base = structuredClone(DEFAULT_SETTINGS);
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<LytexSettings>;
  const out: LytexSettings = {
    ...base,
    ...r,
    timer: { ...base.timer, ...(r.timer ?? {}) },
    csv: { ...base.csv, ...(r.csv ?? {}) },
    rounding: { ...base.rounding, ...(r.rounding ?? {}) },
    doneRules: { ...base.doneRules, ...(r.doneRules ?? {}) },
    integrations: {
      lexwareOffice: {
        ...base.integrations.lexwareOffice,
        ...(r.integrations?.lexwareOffice ?? {}),
      },
    },
  };
  if (!Array.isArray(out.workflow) || out.workflow.length === 0) out.workflow = base.workflow;
  if ((r.settingsVersion ?? 1) < 2) {
    // v1 → v2: drop "Blockiert" from an untouched default workflow; personal team defaults.
    const keys = out.workflow.map((w) => w.key);
    if (JSON.stringify(keys) === JSON.stringify(LEGACY_DEFAULT_WORKFLOW_KEYS)) {
      out.workflow = out.workflow.filter((w) => w.key !== 'blocked');
    }
    if (!r.defaultAssignee || r.defaultAssignee === 'LYTEX')
      out.defaultAssignee = base.defaultAssignee;
    out.settingsVersion = SETTINGS_VERSION;
  }
  if (!Array.isArray(out.team)) out.team = base.team;
  out.team = [...new Set(out.team.map((x) => String(x).trim()).filter(Boolean))];
  if (typeof out.me !== 'string') out.me = base.me;
  out.me = out.me.trim();
  if (out.me && !out.team.includes(out.me)) out.team.unshift(out.me);
  if (!/^#[0-9a-fA-F]{6}$/.test(out.accentColor ?? '')) out.accentColor = DEFAULT_ACCENT;
  if (!Array.isArray(out.dataMigrations)) out.dataMigrations = [];
  if (!Number.isInteger(out.autoArchiveDoneDays) || out.autoArchiveDoneDays < 0)
    out.autoArchiveDoneDays = base.autoArchiveDoneDays;
  if (!Array.isArray(out.budgetThresholds)) out.budgetThresholds = base.budgetThresholds;
  if (typeof out.rootFolder !== 'string' || !out.rootFolder.trim())
    out.rootFolder = base.rootFolder;
  out.rootFolder = out.rootFolder.replace(/^\/+|\/+$/g, '');
  return out;
}

export const FOLDERS = {
  dashboard: '00 Dashboard',
  customers: '01 CRM/Customers',
  contacts: '01 CRM/Contacts',
  interactions: '01 CRM/Interactions',
  projects: '02 Projects',
  timeEntries: '03 Time/Entries',
  timeAdjustments: '03 Time/Adjustments',
  timeReports: '03 Time/Reports',
  quotes: '04 Finance/Quotes',
  batches: '04 Finance/Billing-Batches',
  expenses: '04 Finance/Expenses',
  exports: '04 Finance/Exports',
  recurring: '05 Operations/Recurring Tasks',
  maintenance: '05 Operations/Maintenance',
  sops: '05 Operations/SOPs',
  reviews: '05 Operations/Reviews',
  templates: '06 Templates',
  configuration: '07 Configuration',
  services: '07 Configuration/Services',
  archive: '99 Archive',
} as const;

/**
 * Defaults that are plain data in the user's language (categories, workflow labels). Applied once
 * for fresh installs after the UI language is known; existing settings are never touched.
 */
export function localizeFreshDefaults(s: LytexSettings): void {
  s.ticketCategories = msg(
    'Entwicklung|Bugfix|Support|Wartung|Beratung|Administration',
    'Development|Bugfix|Support|Maintenance|Consulting|Administration',
  ).split('|');
  s.expenseCategories = msg(
    'Hardware|Software/Lizenzen|Hosting|Reise|Material|Sonstiges',
    'Hardware|Software/licences|Hosting|Travel|Material|Other',
  ).split('|');
  const labels: Record<string, string> = {
    backlog: 'Backlog',
    todo: 'To Do',
    in_progress: msg('In Arbeit', 'In progress'),
    review: 'Review',
    done: msg('Erledigt', 'Done'),
    cancelled: msg('Abgebrochen', 'Cancelled'),
  };
  s.workflow = s.workflow.map((w) => ({ ...w, label: labels[w.key] ?? w.label }));
}
