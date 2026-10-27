import type { AppContext } from '../context';
import type { Expense, ExpenseBillingStatus, Quote, QuoteStatus } from '@/domain/schemas/entities';
import type { CreateInput } from '@/infrastructure/persistence/repository';
import { ValidationError } from '@/domain/errors/errors';
import { assertExpenseTransition, assertQuoteTransition } from '@/domain/policies/billing-status';
import { lineTotal, percentOf, sumCents, centsToDecimalString } from '@/shared/money/money';
import { toCsv } from '@/domain/services/csv';
import { nextYearlyNumber } from './numbering';
import { toIso, localDate } from '@/shared/date/time';
import { FOLDERS } from '@/core/configuration/settings';
import { joinPath } from '@/infrastructure/persistence/file-store';
import { msg } from '@/shared/i18n';

export interface QuoteTotals {
  lines: { total_cents: number }[];
  subtotalCents: number;
  discountCents: number;
  netCents: number;
}

export function quoteTotals(q: Pick<Quote, 'lines' | 'discount_bp'>): QuoteTotals {
  const lines = q.lines.map((l) => ({
    total_cents: lineTotal(l.quantity_milli, l.unit_price_cents),
  }));
  const subtotalCents = sumCents(lines.map((l) => l.total_cents));
  const discountCents = percentOf(subtotalCents, q.discount_bp);
  return { lines, subtotalCents, discountCents, netCents: subtotalCents - discountCents };
}

export async function createQuote(
  ctx: AppContext,
  input: Omit<CreateInput<'quote'>, 'quote_number' | 'status' | 'history'>,
  notes = '',
): Promise<Quote> {
  ctx.repo.get('customer', input.customer_id);
  if (input.project_id) ctx.repo.get('project', input.project_id);
  const year = Number(input.issue_date.slice(0, 4));
  const number = nextYearlyNumber(
    ctx.index.all('quote').map((q) => q.quote_number),
    'AN',
    year,
  );
  return ctx.repo.create(
    'quote',
    {
      ...input,
      quote_number: number,
      status: 'draft',
      history: [{ at: toIso(ctx.clock.now()), action: 'created', detail: '' }],
    },
    { description: notes },
  );
}

export async function updateQuote(
  ctx: AppContext,
  id: string,
  patch: Partial<Quote>,
  expectedUpdatedAt?: string,
): Promise<Quote> {
  const cur = ctx.repo.get('quote', id);
  if (cur.status !== 'draft' && (patch.lines || patch.discount_bp !== undefined))
    throw new ValidationError(
      msg('Nur Entwürfe können inhaltlich geändert werden', 'Only drafts can be edited'),
    );
  return ctx.repo.update(
    'quote',
    id,
    (d) => ({
      ...d,
      ...patch,
      id: d.id,
      type: d.type,
      status: d.status,
      quote_number: d.quote_number,
      created_at: d.created_at,
    }),
    { expectedUpdatedAt },
  );
}

export async function setQuoteStatus(
  ctx: AppContext,
  id: string,
  status: QuoteStatus,
): Promise<Quote> {
  return ctx.repo.update('quote', id, (d) => {
    assertQuoteTransition(d.status, status);
    d.history.push({
      at: toIso(ctx.clock.now()),
      action: 'status',
      detail: `${d.status} → ${status}`,
    });
    d.status = status;
  });
}

/** Mark sent quotes past their validity date as expired (run on startup / daily). */
export async function expireQuotes(ctx: AppContext): Promise<number> {
  const today = localDate(ctx.clock.now());
  let n = 0;
  for (const q of ctx.index.all('quote')) {
    if (q.status === 'sent' && q.valid_until && q.valid_until < today) {
      await setQuoteStatus(ctx, q.id, 'expired');
      n++;
    }
  }
  return n;
}

export async function exportQuoteCsv(ctx: AppContext, id: string): Promise<string> {
  const q = ctx.repo.get('quote', id);
  const s = ctx.settings();
  const dec = s.csv.decimalSeparator;
  const t = quoteTotals(q);
  const rows = q.lines.map((l, i) => [
    q.quote_number,
    l.description,
    (l.quantity_milli / 1000).toFixed(3).replace('.', dec),
    l.unit,
    centsToDecimalString(l.unit_price_cents, dec),
    centsToDecimalString(t.lines[i]!.total_cents, dec),
    q.currency,
  ]);
  if (t.discountCents)
    rows.push([
      q.quote_number,
      msg(`Rabatt ${q.discount_bp / 100} %`, `Discount ${q.discount_bp / 100} %`),
      '',
      '',
      '',
      centsToDecimalString(-t.discountCents, dec),
      q.currency,
    ]);
  rows.push([
    q.quote_number,
    msg('Netto gesamt', 'Net total'),
    '',
    '',
    '',
    centsToDecimalString(t.netCents, dec),
    q.currency,
  ]);
  const csv = toCsv(
    msg(
      'Angebot|Beschreibung|Menge|Einheit|Einzelpreis|Gesamt|Währung',
      'Quote|Description|Quantity|Unit|Unit price|Total|Currency',
    ).split('|'),
    rows,
    { delimiter: s.csv.delimiter, guardFormulas: true },
  );
  const folder = joinPath(s.rootFolder, FOLDERS.exports);
  await ctx.files.ensureFolder(folder);
  const path = joinPath(
    folder,
    `${q.quote_number}_${toIso(ctx.clock.now()).replace(/[:T]/g, '-').replace('Z', '')}.csv`,
  );
  await ctx.files.create(path, csv);
  return path;
}

export async function createExpense(
  ctx: AppContext,
  input: CreateInput<'expense'>,
  notes = '',
): Promise<Expense> {
  let customer_id = input.customer_id;
  if (input.project_id) {
    const p = ctx.repo.get('project', input.project_id);
    if (customer_id && p.customer_id && customer_id !== p.customer_id)
      throw new ValidationError(
        msg('Kunde passt nicht zum Projekt', 'Customer does not match the project'),
      );
    customer_id = customer_id ?? p.customer_id;
  }
  if (input.billing_status !== 'not_billable' && !customer_id)
    throw new ValidationError(
      msg(
        'Weiterberechenbare Ausgaben benötigen einen Kunden',
        'Rebillable expenses need a customer',
      ),
    );
  return ctx.repo.create('expense', { ...input, customer_id }, { description: notes });
}

export async function updateExpense(
  ctx: AppContext,
  id: string,
  patch: Partial<Expense>,
  expectedUpdatedAt?: string,
): Promise<Expense> {
  const cur = ctx.repo.get('expense', id);
  if (cur.billing_status === 'reserved' || cur.billing_status === 'invoiced')
    throw new ValidationError(
      msg(
        'Ausgaben in Abrechnung können nicht geändert werden',
        'Expenses in billing cannot be changed',
      ),
    );
  return ctx.repo.update(
    'expense',
    id,
    (d) => ({
      ...d,
      ...patch,
      id: d.id,
      type: d.type,
      created_at: d.created_at,
      billing_status: d.billing_status,
      billing_batch_id: d.billing_batch_id,
    }),
    { expectedUpdatedAt },
  );
}

export async function setExpenseStatus(
  ctx: AppContext,
  id: string,
  to: ExpenseBillingStatus,
): Promise<Expense> {
  return ctx.repo.update('expense', id, (d) => {
    assertExpenseTransition(d.billing_status, to);
    if (to !== 'not_billable' && !d.customer_id)
      throw new ValidationError(
        msg(
          'Weiterberechenbare Ausgaben benötigen einen Kunden',
          'Rebillable expenses need a customer',
        ),
      );
    d.billing_status = to;
  });
}

export async function exportExpensesCsv(
  ctx: AppContext,
  from: string,
  to: string,
): Promise<string> {
  const s = ctx.settings();
  const dec = s.csv.decimalSeparator;
  const list = ctx.index
    .all('expense')
    .filter((x) => !x.archived && x.date >= from && x.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date));
  const rows = list.map((x) => [
    x.date,
    x.vendor,
    x.description,
    x.category,
    centsToDecimalString(x.amount_cents, dec),
    x.currency,
    x.reimbursable ? msg('ja', 'yes') : msg('nein', 'no'),
    x.billing_status,
    ctx.index.get('customer', x.customer_id)?.name ?? '',
    ctx.index.get('project', x.project_id)?.name ?? '',
    x.receipt,
    x.id,
  ]);
  const csv = toCsv(
    msg(
      'Datum|Lieferant|Beschreibung|Kategorie|Betrag|Währung|Erstattungsfähig|Abrechnungsstatus|Kunde|Projekt|Beleg|ID',
      'Date|Vendor|Description|Category|Amount|Currency|Reimbursable|Billing status|Customer|Project|Receipt|ID',
    ).split('|'),
    rows,
    { delimiter: s.csv.delimiter, guardFormulas: true },
  );
  const folder = joinPath(s.rootFolder, FOLDERS.exports);
  await ctx.files.ensureFolder(folder);
  const path = joinPath(
    folder,
    `${msg('Ausgaben', 'Expenses')}_${from}_${to}_${toIso(ctx.clock.now()).replace(/[:T]/g, '-').replace('Z', '')}.csv`,
  );
  await ctx.files.create(path, csv);
  return path;
}

export async function exportTimesheetCsv(
  ctx: AppContext,
  from: string,
  to: string,
  projectId: string | null,
): Promise<string> {
  const s = ctx.settings();
  const dec = s.csv.decimalSeparator;
  const list = ctx.index
    .all('time_entry')
    .filter((e) => !e.archived && (!projectId || e.project_id === projectId))
    .filter((e) => {
      const d = localDate(Date.parse(e.started_at));
      return d >= from && d <= to;
    })
    .sort((a, b) => a.started_at.localeCompare(b.started_at));
  const rows = list.map((e) => {
    const p = ctx.index.get('project', e.project_id);
    const t = ctx.index.get('ticket', e.ticket_id);
    return [
      localDate(Date.parse(e.started_at)),
      e.started_at,
      e.ended_at,
      (e.duration_seconds / 3600).toFixed(2).replace('.', dec),
      p ? `${p.project_number} ${p.name}` : e.project_id,
      t ? `${t.ticket_number} ${t.title}` : '',
      e.description,
      e.billable ? msg('ja', 'yes') : msg('nein', 'no'),
      e.billing_status,
      centsToDecimalString(e.rate_cents, dec),
      e.id,
    ];
  });
  const csv = toCsv(
    msg(
      'Datum|Beginn (UTC)|Ende (UTC)|Stunden|Projekt|Ticket|Beschreibung|Abrechenbar|Status|Stundensatz|ID',
      'Date|Start (UTC)|End (UTC)|Hours|Project|Ticket|Description|Billable|Status|Hourly rate|ID',
    ).split('|'),
    rows,
    { delimiter: s.csv.delimiter, guardFormulas: true },
  );
  const folder = joinPath(s.rootFolder, FOLDERS.timeReports);
  await ctx.files.ensureFolder(folder);
  const path = joinPath(
    folder,
    `${msg('Zeitnachweis', 'Timesheet')}_${from}_${to}_${toIso(ctx.clock.now()).replace(/[:T]/g, '-').replace('Z', '')}.csv`,
  );
  await ctx.files.create(path, csv);
  return path;
}
