/**
 * Generates the fictional example dataset through the real use cases (so it is always valid).
 * All companies, people and numbers are invented.
 */
import { OpsCore } from '../src/core/bootstrap/core';
import { DEFAULT_SETTINGS } from '../src/core/configuration/settings';
import { writeOverviewNotes } from '../src/infrastructure/markdown/generated-notes';
import { createCustomer, createContact, createInteraction } from '../src/application/use-cases/crm';
import { createProject } from '../src/application/use-cases/projects';
import {
  createTicket,
  changeTicketStatus,
  addChecklistItem,
} from '../src/application/use-cases/tickets';
import { createManualEntry, setBillingStatus } from '../src/application/use-cases/time';
import { createBatch, confirmInvoice, recordPayment } from '../src/application/use-cases/billing';
import {
  createQuote,
  setQuoteStatus,
  createExpense,
  setExpenseStatus,
} from '../src/application/use-cases/finance';
import { createRecurringTask, reconcileRecurring } from '../src/application/use-cases/recurring';
import {
  localDate,
  localDateTime,
  addDays,
  toIso,
  startOfWeek,
  systemClock,
} from '../src/shared/date/time';
import { NodeFileStore, NodeRawStore } from './node-store';

const addr = (street: string, zip: string, city: string) => ({ street, zip, city, country: 'DE' });

export async function generate(vaultDir: string, stateDir: string): Promise<{ entities: number }> {
  // Fictional team for the example data.
  const settings = {
    ...structuredClone(DEFAULT_SETTINGS),
    team: ['Alex Beispiel', 'Sam Muster'],
    me: 'Alex Beispiel',
    defaultAssignee: 'Alex Beispiel',
  };
  const files = new NodeFileStore(vaultDir);
  const core = new OpsCore(files, new NodeRawStore(stateDir), () => settings, systemClock);
  await core.start({ reconcile: false });
  await core.ensureStructure();
  await writeOverviewNotes(files, settings, true);
  const ctx = core.ctx;
  const today = localDate(Date.now());
  const monday = startOfWeek(today);

  const web = await core.repo.create('service', {
    name: 'Webentwicklung',
    rate_cents: 7000,
    billable: true,
    description: 'Websites, Webanwendungen',
  });
  const consulting = await core.repo.create('service', {
    name: 'Beratung',
    rate_cents: 8500,
    billable: true,
    description: 'IT-Beratung und Konzeption',
  });
  const admin = await core.repo.create('service', {
    name: 'Server-Administration',
    rate_cents: 7500,
    billable: true,
    description: 'Linux, Nextcloud, Backups',
  });

  const base = {
    customer_kind: 'business' as const,
    status: 'active' as const,
    phone: '',
    billing_address: null,
    tax_number: '',
    external_accounting_id: '',
    default_rate_cents: null,
    currency: 'EUR' as const,
    payment_terms_days: 14,
    password_manager_ref: '',
  };
  const baeckerei = await createCustomer(
    ctx,
    {
      ...base,
      name: 'Musterbäckerei Korn GmbH',
      email: 'info@musterbaeckerei.example',
      website: 'https://musterbaeckerei.example',
      address: addr('Mehlweg 3', '12345', 'Beispielstadt'),
      vat_id: 'DE000000001',
      password_manager_ref: 'Bitwarden: Musterbäckerei / Hosting',
    },
    'Fiktiver Beispielkunde.',
  );
  const kanzlei = await createCustomer(ctx, {
    ...base,
    name: 'Beispiel Steuerberatung Partner mbB',
    email: 'kanzlei@stb-beispiel.example',
    website: 'https://stb-beispiel.example',
    address: addr('Paragraphenstr. 7', '54321', 'Musterhausen'),
    vat_id: '',
    default_rate_cents: 8000,
    payment_terms_days: 30,
  });
  const praxis = await createCustomer(ctx, {
    ...base,
    name: 'Praxis Dr. Fiktiv',
    email: 'praxis@fiktiv.example',
    website: '',
    address: addr('Gesundweg 1', '11111', 'Demodorf'),
    vat_id: '',
  });
  const verein = await createCustomer(ctx, {
    ...base,
    customer_kind: 'private',
    status: 'lead',
    name: 'Nordlicht Sportverein e. V. (Interessent)',
    email: 'vorstand@nordlicht.example',
    website: '',
    address: addr('', '', 'Nordhafen'),
    vat_id: '',
  });

  await createContact(ctx, {
    customer_id: baeckerei.id,
    first_name: 'Erika',
    last_name: 'Mustermann',
    role: 'Geschäftsführung',
    email: 'erika@musterbaeckerei.example',
    phone: '',
    primary: true,
  });
  await createContact(ctx, {
    customer_id: kanzlei.id,
    first_name: 'Max',
    last_name: 'Beispiel',
    role: 'Partner',
    email: 'max@stb-beispiel.example',
    phone: '',
    primary: true,
  });
  await createInteraction(
    ctx,
    {
      customer_id: verein.id,
      project_id: null,
      contact_ids: [],
      kind: 'call',
      occurred_at: toIso(Date.now() - 2 * 86400_000),
      subject: 'Erstgespräch neue Vereinswebsite',
      follow_up_date: addDays(today, 5),
    },
    'Interesse an Website + Mitgliederverwaltung. Angebot zusenden.',
  );

  const P = {
    status: 'active' as const,
    priority: 'normal' as const,
    start_date: addDays(today, -40),
    completed_date: null,
    rate_cents: null,
    daily_rate_cents: null,
    billing_unit: 'hour' as const,
    fixed_price_cents: null,
    retainer_monthly_fee_cents: null,
    retainer_included_seconds: null,
    budget_cents: null,
    budget_seconds: null,
    estimated_seconds: null,
    internal_cost_rate_cents: 3500,
    currency: 'EUR' as const,
    milestones: [],
    doc_links: [],
  };
  const relaunch = await createProject(
    ctx,
    {
      ...P,
      customer_id: baeckerei.id,
      name: 'Website Relaunch',
      key: 'BACK',
      billing_model: 'time_and_materials',
      service_id: web.id,
      deadline: addDays(today, 21),
      budget_cents: 600000,
      estimated_seconds: 80 * 3600,
    },
    'Neue Website mit Online-Bestellung für Vorbestellungen.',
  );
  const dms = await createProject(ctx, {
    ...P,
    customer_id: kanzlei.id,
    name: 'Nextcloud Einführung',
    key: 'STB',
    billing_model: 'fixed_price',
    fixed_price_cents: 450000,
    service_id: admin.id,
    deadline: addDays(today, 10),
    estimated_seconds: 50 * 3600,
  });
  const wartung = await createProject(ctx, {
    ...P,
    customer_id: praxis.id,
    name: 'IT-Wartungsvertrag',
    key: 'PRX',
    billing_model: 'retainer',
    retainer_monthly_fee_cents: 35000,
    retainer_included_seconds: 4 * 3600,
    service_id: admin.id,
  });
  const intern = await createProject(ctx, {
    ...P,
    customer_id: null,
    name: 'LYTEX Website & Marketing',
    key: 'LYX',
    billing_model: 'internal',
    internal_cost_rate_cents: null,
  });

  const T = {
    status: 'todo',
    priority: 'normal' as const,
    category: 'Entwicklung',
    due_date: null,
    estimated_seconds: 4 * 3600,
    billable: true,
    assignees: ['Alex Beispiel'],
    parent_id: null,
    depends_on: [],
    checklist: [],
    sort_order: 0,
    recurring_task_id: null,
    occurrence_key: '',
    service_id: null,
  };
  const t1 = await createTicket(ctx, {
    ...T,
    project_id: relaunch.id,
    title: 'Design-Entwurf Startseite',
    status: 'done',
    estimated_seconds: 6 * 3600,
  });
  const t2 = await createTicket(ctx, {
    ...T,
    project_id: relaunch.id,
    title: 'Vorbestellformular umsetzen',
    status: 'in_progress',
    priority: 'high',
    due_date: addDays(today, 3),
    estimated_seconds: 10 * 3600,
  });
  await addChecklistItem(ctx, t2.id, 'Formularfelder abstimmen', true);
  await addChecklistItem(ctx, t2.id, 'E-Mail-Benachrichtigung');
  const t3 = await createTicket(ctx, {
    ...T,
    project_id: relaunch.id,
    title: 'Impressum & Datenschutz einbinden',
    status: 'todo',
    due_date: addDays(today, -2),
    estimated_seconds: 2 * 3600,
    depends_on: [t1.id],
  });
  await createTicket(ctx, {
    ...T,
    project_id: relaunch.id,
    title: 'Go-Live vorbereiten',
    status: 'backlog',
    depends_on: [t2.id, t3.id],
  });
  const s1 = await createTicket(ctx, {
    ...T,
    project_id: dms.id,
    title: 'Nextcloud-Server aufsetzen',
    status: 'done',
    category: 'Administration',
  });
  const s2 = await createTicket(ctx, {
    ...T,
    project_id: dms.id,
    title: 'Benutzer & Gruppen anlegen',
    status: 'review',
    category: 'Administration',
  });
  await createTicket(ctx, {
    ...T,
    project_id: dms.id,
    title: 'Schulung Mitarbeitende',
    status: 'todo',
    category: 'Beratung',
    due_date: addDays(today, 9),
    service_id: consulting.id,
  });
  const p1 = await createTicket(ctx, {
    ...T,
    project_id: wartung.id,
    title: 'Drucker im Empfang streikt',
    status: 'done',
    category: 'Support',
    priority: 'high',
  });
  const i1 = await createTicket(ctx, {
    ...T,
    project_id: intern.id,
    title: 'Blogartikel Backup-Strategien',
    status: 'in_progress',
    category: 'Marketing',
    billable: false,
  });
  await changeTicketStatus(ctx, t1.id, 'done').catch(() => undefined);

  // Time entries over the last ~3 weeks.
  const entry = async (
    dayOffset: number,
    from: string,
    to: string,
    project: string,
    ticket: string | null,
    description: string,
    billable = true,
  ) => {
    const d = addDays(monday, dayOffset);
    if (d > today) return null;
    return createManualEntry(ctx, {
      project_id: project,
      ticket_id: ticket,
      description,
      start: localDateTime(d, from)!,
      end: localDateTime(d, to)!,
      billable,
      overlap_acknowledged: true,
    });
  };
  const old: string[] = [];
  for (const [off, a, b, p, tk, desc] of [
    [-14, '08:30', '11:45', relaunch.id, t1.id, 'Moodboard und Entwurf'],
    [-13, '09:00', '12:30', relaunch.id, t1.id, 'Entwurf überarbeitet'],
    [-12, '13:00', '16:00', dms.id, s1.id, 'Server-Installation'],
    [-11, '08:00', '09:15', wartung.id, p1.id, 'Fernwartung Drucker'],
    [-10, '10:00', '13:00', dms.id, s1.id, 'TLS, Backups, Monitoring'],
    [-9, '14:00', '15:30', intern.id, i1.id, 'Recherche Blogartikel'],
  ] as const) {
    const e = await entry(off, a, b, p, tk, desc, p !== intern.id);
    if (e && p === relaunch.id) old.push(e.id);
  }
  for (const [off, a, b, p, tk, desc] of [
    [-7, '08:30', '12:00', relaunch.id, t2.id, 'Formular-Prototyp'],
    [-6, '09:00', '11:00', dms.id, s2.id, 'Gruppenstruktur'],
    [-5, '13:30', '17:00', relaunch.id, t2.id, 'Validierung & Versand'],
    [-4, '10:00', '10:45', wartung.id, null, 'Monatliche Updates'],
    [-3, '08:00', '09:30', intern.id, i1.id, 'Blogartikel Entwurf'],
    [0, '08:15', '10:30', relaunch.id, t2.id, 'Benachrichtigungen'],
    [1, '09:00', '11:30', dms.id, s2.id, 'Freigaben konfigurieren'],
    [2, '08:30', '12:00', relaunch.id, t3.id, 'Rechtstexte eingebunden'],
  ] as const) {
    await entry(off, a, b, p, tk, desc, p !== intern.id);
  }

  // Bill the older relaunch work: approve → batch → export → invoice confirmed → paid.
  if (old.length) {
    await setBillingStatus(ctx, old, 'approved');
    const batch = await createBatch(ctx, {
      customer_id: baeckerei.id,
      entry_ids: old,
      expense_ids: [],
      include_fixed_price: [],
      retainer_months: {},
      discount_bp: 0,
      period_from: addDays(monday, -14),
      period_to: addDays(monday, -8),
    });
    await confirmInvoice(ctx, batch.id, 'RE-BEISPIEL-0001', addDays(monday, -7));
    await recordPayment(ctx, batch.id, addDays(monday, -2), batch.net_cents);
  }

  const x = await createExpense(ctx, {
    customer_id: null,
    project_id: relaunch.id,
    date: addDays(today, -6),
    vendor: 'Beispiel-Hosting AG',
    description: 'Domain musterbaeckerei.example (1 Jahr)',
    category: 'Hosting',
    amount_cents: 1499,
    currency: 'EUR',
    reimbursable: true,
    billing_status: 'unbilled',
    billing_batch_id: null,
    receipt: '',
  });
  await setExpenseStatus(ctx, x.id, 'approved');
  await createExpense(ctx, {
    customer_id: null,
    project_id: intern.id,
    date: addDays(today, -3),
    vendor: 'Fiktiv Software GmbH',
    description: 'Lizenz Grafiktool',
    category: 'Software/Lizenzen',
    amount_cents: 2900,
    currency: 'EUR',
    reimbursable: false,
    billing_status: 'not_billable',
    billing_batch_id: null,
    receipt: '',
  });

  const q = await createQuote(ctx, {
    customer_id: verein.id,
    project_id: null,
    title: 'Vereinswebsite mit Mitgliederbereich',
    issue_date: today,
    valid_until: addDays(today, 30),
    currency: 'EUR',
    discount_bp: 500,
    lines: [
      {
        description: 'Konzeption & Design',
        quantity_milli: 8000,
        unit: 'Std.',
        unit_price_cents: 8500,
      },
      { description: 'Umsetzung', quantity_milli: 24000, unit: 'Std.', unit_price_cents: 7000 },
      { description: 'Einweisung', quantity_milli: 2000, unit: 'Std.', unit_price_cents: 7000 },
    ],
  });
  await setQuoteStatus(ctx, q.id, 'sent');

  await createRecurringTask(ctx, {
    title: 'Monatliche Wartung Praxis',
    customer_id: null,
    project_id: wartung.id,
    service_id: admin.id,
    recurrence: { freq: 'monthly', interval: 1, weekdays: [], day_of_month: 1 },
    start_date: addDays(today, -60),
    end_date: null,
    lead_days: 7,
    estimated_seconds: 3600,
    priority: 'normal',
    billable: true,
    active: true,
    category: 'Wartung',
    checklist: ['Updates einspielen', 'Backup-Restore testen', 'Protokoll an Praxis'],
  });
  await createRecurringTask(ctx, {
    title: 'Backup-Prüfung Kanzlei',
    customer_id: null,
    project_id: dms.id,
    service_id: admin.id,
    recurrence: { freq: 'weekly', interval: 1, weekdays: [5], day_of_month: null },
    start_date: addDays(today, -10),
    end_date: null,
    lead_days: 3,
    estimated_seconds: 1800,
    priority: 'normal',
    billable: true,
    active: true,
    category: 'Wartung',
    checklist: ['Backup-Log prüfen'],
  });
  await reconcileRecurring(ctx);

  return { entities: core.index.size };
}
