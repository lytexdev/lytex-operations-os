import type { AppContext } from '../context';
import type { BillingBatch, Project, TimeEntry } from '@/domain/schemas/entities';
import { DomainError, ValidationError } from '@/domain/errors/errors';
import {
  computeBatch,
  isBatchEligible,
  isExpenseBatchEligible,
  type BatchComputation,
} from '@/domain/services/billing';
import {
  assertBatchTransition,
  assertExpenseTransition,
  assertTimeTransition,
} from '@/domain/policies/billing-status';
import { toCsv } from '@/domain/services/csv';
import { centsToDecimalString } from '@/shared/money/money';
import {
  formatLocalDate,
  localDate,
  parseIso,
  toIso,
  isIsoDate,
  type IsoDate,
} from '@/shared/date/time';
import { nextYearlyNumber } from './numbering';
import { FOLDERS } from '@/core/configuration/settings';
import { joinPath } from '@/infrastructure/persistence/file-store';
import type { PlannedWrite } from '@/infrastructure/persistence/repository';
import { msg } from '@/shared/i18n';

export interface BatchRequest {
  customer_id: string | null;
  entry_ids: string[];
  expense_ids: string[];
  include_fixed_price: string[];
  retainer_months: Record<string, number>;
  discount_bp: number;
  period_from: IsoDate | null;
  period_to: IsoDate | null;
}

export interface BillingFilter {
  customer_id?: string | null;
  project_id?: string | null;
  from?: IsoDate | null;
  to?: IsoDate | null;
  statuses?: TimeEntry['billing_status'][];
}

export function filterEntries(ctx: AppContext, f: BillingFilter): TimeEntry[] {
  return ctx.index
    .all('time_entry')
    .filter((e) => {
      if (e.archived) return false;
      if (f.statuses && !f.statuses.includes(e.billing_status)) return false;
      if (f.customer_id && e.customer_id !== f.customer_id) return false;
      if (f.project_id && e.project_id !== f.project_id) return false;
      const d = localDate(parseIso(e.started_at));
      if (f.from && d < f.from) return false;
      if (f.to && d > f.to) return false;
      return true;
    })
    .sort((a, b) => a.started_at.localeCompare(b.started_at));
}

function computeFor(
  ctx: AppContext,
  req: BatchRequest,
): { comp: BatchComputation; entries: TimeEntry[]; projects: Map<string, Project> } {
  const s = ctx.settings();
  const entries = req.entry_ids.map((id) => ctx.repo.get('time_entry', id));
  const expenses = req.expense_ids.map((id) => ctx.repo.get('expense', id));
  const customerIds = new Set(
    [...entries.map((e) => e.customer_id), ...expenses.map((x) => x.customer_id)].filter(Boolean),
  );
  if (req.customer_id) customerIds.add(req.customer_id);
  if (customerIds.size > 1)
    throw new ValidationError(
      msg(
        'Ein Abrechnungslauf darf nur Positionen eines Kunden enthalten',
        'A billing batch may only contain items of one customer',
      ),
    );
  const currencies = new Set([
    ...entries.map((e) => e.currency),
    ...expenses.map((x) => x.currency),
  ]);
  if (currencies.size > 1)
    throw new ValidationError(
      msg(
        'Positionen mit unterschiedlichen Währungen können nicht gemeinsam abgerechnet werden',
        'Items in different currencies cannot be billed together',
      ),
    );
  const projects = new Map<string, Project>();
  for (const id of [
    ...entries.map((e) => e.project_id),
    ...req.include_fixed_price,
    ...Object.keys(req.retainer_months),
  ])
    projects.set(id, ctx.repo.get('project', id));
  const titles = new Map(
    ctx.index.all('ticket').map((t) => [t.id, `${t.ticket_number} ${t.title}`]),
  );
  const comp = computeBatch({
    entries,
    expenses,
    projects,
    rounding: s.rounding,
    standardDaySeconds: s.standardDaySeconds,
    periodFrom: req.period_from,
    periodTo: req.period_to,
    includeFixedPrice: req.include_fixed_price,
    retainerMonths: req.retainer_months,
    discountBasisPoints: req.discount_bp,
    ticketTitles: titles,
  });
  return { comp, entries, projects };
}

/** Preview without side effects. */
export function previewBatch(ctx: AppContext, req: BatchRequest): BatchComputation {
  return computeFor(ctx, req).comp;
}

/**
 * Create a billing batch: one journaled multi-file operation that writes the batch note and
 * marks all included entries/expenses as `reserved` with a back-reference. If Obsidian crashes
 * midway, the journal completes the operation on next start; the index integrity check also
 * reports half-applied batches.
 */
export async function createBatch(ctx: AppContext, req: BatchRequest): Promise<BillingBatch> {
  if (
    !req.entry_ids.length &&
    !req.expense_ids.length &&
    !req.include_fixed_price.length &&
    !Object.values(req.retainer_months).some((m) => m > 0)
  ) {
    throw new ValidationError(
      msg('Der Abrechnungslauf enthält keine Positionen', 'The billing batch has no items'),
    );
  }
  if (new Set(req.entry_ids).size !== req.entry_ids.length)
    throw new ValidationError(
      msg('Doppelte Zeiteinträge im Abrechnungslauf', 'Duplicate time entries in billing batch'),
    );
  return ctx.repo.exclusive(async () => {
    // Re-check eligibility inside the write lock (prevents double billing from two quick clicks).
    for (const id of req.entry_ids) {
      const e = ctx.repo.get('time_entry', id);
      if (!isBatchEligible(e))
        throw new DomainError(
          'double_billing',
          msg(
            `Zeiteintrag ${id} ist bereits in Abrechnung oder nicht freigegeben`,
            `Time entry ${id} is already being billed or not approved`,
          ),
        );
    }
    for (const id of req.expense_ids) {
      if (!isExpenseBatchEligible(ctx.repo.get('expense', id)))
        throw new DomainError(
          'double_billing',
          msg(
            `Ausgabe ${id} ist bereits in Abrechnung oder nicht freigegeben`,
            `Expense ${id} is already being billed or not approved`,
          ),
        );
    }
    const { comp, entries } = computeFor(ctx, req);
    const s = ctx.settings();
    const year = new Date(ctx.clock.now()).getFullYear();
    const number = nextYearlyNumber(
      ctx.index.all('billing_batch').map((b) => b.batch_number),
      'AB',
      year,
    );
    const customerId = req.customer_id ?? entries[0]?.customer_id ?? null;
    const now = toIso(ctx.clock.now());
    const batchW = await ctx.repo.planCreate('billing_batch', {
      batch_number: number,
      customer_id: customerId,
      project_ids: [
        ...new Set([
          ...entries.map((e) => e.project_id),
          ...req.include_fixed_price,
          ...Object.keys(req.retainer_months),
        ]),
      ],
      period_from: req.period_from,
      period_to: req.period_to,
      status: 'draft',
      currency: entries[0]?.currency ?? s.currency,
      entry_ids: req.entry_ids,
      expense_ids: req.expense_ids,
      lines: comp.lines,
      net_cents: comp.netCents,
      rounding: { ...s.rounding },
      exports: [],
      invoice_ref: '',
      invoice_date: null,
      invoiced_at: null,
      paid_at: null,
      paid_cents: null,
      history: [
        {
          at: now,
          action: 'created',
          detail: msg(
            `${req.entry_ids.length} Zeiteinträge, ${req.expense_ids.length} Ausgaben`,
            `${req.entry_ids.length} time entries, ${req.expense_ids.length} expenses`,
          ),
        },
      ],
    });
    const batchId = batchW.entity.id;
    const writes: PlannedWrite[] = [batchW];
    for (const id of req.entry_ids) {
      writes.push(
        await ctx.repo.planUpdate('time_entry', id, (d) => {
          assertTimeTransition(d.billing_status, 'reserved');
          d.billing_status = 'reserved';
          d.billing_batch_id = batchId;
          d.history.push({
            at: now,
            action: 'billing_status',
            detail: `approved → reserved (${number})`,
          });
        }),
      );
    }
    for (const id of req.expense_ids) {
      writes.push(
        await ctx.repo.planUpdate('expense', id, (d) => {
          assertExpenseTransition(d.billing_status, 'reserved');
          d.billing_status = 'reserved';
          d.billing_batch_id = batchId;
        }),
      );
    }
    await ctx.repo.commit(`create billing batch ${number}`, writes);
    return batchW.entity as BillingBatch;
  });
}

/** Cancel a batch that has not been invoiced: entries go back to `approved`. */
export async function cancelBatch(ctx: AppContext, batchId: string, reason: string): Promise<void> {
  await ctx.repo.exclusive(async () => {
    const b = ctx.repo.get('billing_batch', batchId);
    assertBatchTransition(b.status, 'cancelled');
    const now = toIso(ctx.clock.now());
    const writes: PlannedWrite[] = [];
    writes.push(
      await ctx.repo.planUpdate('billing_batch', batchId, (d) => {
        d.status = 'cancelled';
        d.history.push({ at: now, action: 'cancelled', detail: reason });
      }),
    );
    for (const id of b.entry_ids) {
      const e = ctx.index.get('time_entry', id);
      if (!e || e.billing_batch_id !== batchId) continue;
      writes.push(
        await ctx.repo.planUpdate('time_entry', id, (d) => {
          assertTimeTransition(d.billing_status, 'approved');
          d.billing_status = 'approved';
          d.billing_batch_id = null;
          d.history.push({
            at: now,
            action: 'billing_status',
            detail: msg(
              `reserved → approved (${b.batch_number} storniert)`,
              `reserved → approved (${b.batch_number} cancelled)`,
            ),
          });
        }),
      );
    }
    for (const id of b.expense_ids) {
      const x = ctx.index.get('expense', id);
      if (!x || x.billing_batch_id !== batchId) continue;
      writes.push(
        await ctx.repo.planUpdate('expense', id, (d) => {
          d.billing_status = 'approved';
          d.billing_batch_id = null;
        }),
      );
    }
    await ctx.repo.commit(`cancel billing batch ${b.batch_number}`, writes);
  });
}

export const csvHeader = (): string[] =>
  msg(
    'Abrechnungslauf|Kunde|Kundennummer|Projekt|Datum|Art|Beschreibung|Menge|Einheit|Einzelpreis|Gesamt|Währung|Referenzen',
    'Billing batch|Customer|Customer number|Project|Date|Kind|Description|Quantity|Unit|Unit price|Total|Currency|References',
  ).split('|');

export function batchCsv(ctx: AppContext, batch: BillingBatch): string {
  const s = ctx.settings();
  const customer = ctx.index.get('customer', batch.customer_id);
  const dec = s.csv.decimalSeparator;
  const qty = (milli: number) => {
    const neg = milli < 0;
    const a = Math.abs(milli);
    return `${neg ? '-' : ''}${Math.floor(a / 1000)}${dec}${String(a % 1000).padStart(3, '0')}`;
  };
  const rows = batch.lines.map((l) => {
    const ref = l.ref_ids[0] ? ctx.index.get('time_entry', l.ref_ids[0]) : undefined;
    const project = ref
      ? ctx.index.get('project', ref.project_id)
      : l.ref_ids[0]
        ? ctx.index.get('project', l.ref_ids[0])
        : undefined;
    return [
      batch.batch_number,
      customer?.name ?? '',
      customer?.external_accounting_id || customer?.customer_number || '',
      project ? `${project.project_number} ${project.name}` : '',
      ref ? formatLocalDate(parseIso(ref.started_at)) : '',
      l.kind,
      l.description,
      qty(l.quantity_milli),
      l.unit,
      centsToDecimalString(l.unit_price_cents, dec),
      centsToDecimalString(l.total_cents, dec),
      batch.currency,
      l.ref_ids.join(' '),
    ];
  });
  rows.push([
    '',
    '',
    '',
    '',
    '',
    'summe',
    msg('Netto gesamt', 'Net total'),
    '',
    '',
    '',
    centsToDecimalString(batch.net_cents, dec),
    batch.currency,
    '',
  ]);
  return toCsv(csvHeader(), rows, { delimiter: s.csv.delimiter, guardFormulas: true });
}

/**
 * Export a batch as CSV into 04 Finance/Exports. Exporting does NOT mark anything as invoiced;
 * invoicing requires an explicit confirmation with the external invoice reference.
 */
export async function exportBatchCsv(ctx: AppContext, batchId: string): Promise<string> {
  const b = ctx.repo.get('billing_batch', batchId);
  if (b.status === 'cancelled')
    throw new DomainError(
      'batch_cancelled',
      msg(
        'Stornierte Abrechnungsläufe können nicht exportiert werden',
        'Cancelled billing batches cannot be exported',
      ),
    );
  const csv = batchCsv(ctx, b);
  const stamp = toIso(ctx.clock.now()).replace(/[:T]/g, '-').replace('Z', '');
  const folder = joinPath(ctx.settings().rootFolder, FOLDERS.exports);
  const path = joinPath(folder, `${b.batch_number}_${stamp}.csv`);
  await ctx.files.ensureFolder(folder);
  await ctx.files.create(path, csv);
  await ctx.repo.update('billing_batch', batchId, (d) => {
    if (d.status === 'draft') d.status = 'exported';
    d.exports.push({ at: toIso(ctx.clock.now()), path, format: 'csv', rows: d.lines.length });
    d.history.push({ at: toIso(ctx.clock.now()), action: 'exported', detail: path });
  });
  return path;
}

/** Explicit confirmation that the invoice was created in the accounting system. */
export async function confirmInvoice(
  ctx: AppContext,
  batchId: string,
  invoiceRef: string,
  invoiceDate: IsoDate,
): Promise<void> {
  if (!invoiceRef.trim())
    throw new ValidationError(
      msg('Rechnungsnummer ist erforderlich', 'Invoice number is required'),
    );
  if (!isIsoDate(invoiceDate))
    throw new ValidationError(msg('Rechnungsdatum ist ungültig', 'Invoice date is invalid'));
  const dup = ctx.index
    .all('billing_batch')
    .find(
      (b) =>
        b.id !== batchId && b.invoice_ref.trim() === invoiceRef.trim() && b.status === 'invoiced',
    );
  if (dup)
    throw new ValidationError(
      msg(
        `Rechnungsnummer ${invoiceRef} ist bereits ${dup.batch_number} zugeordnet`,
        `Invoice number ${invoiceRef} is already assigned to ${dup.batch_number}`,
      ),
    );
  await ctx.repo.exclusive(async () => {
    const b = ctx.repo.get('billing_batch', batchId);
    assertBatchTransition(b.status, 'invoiced');
    const now = toIso(ctx.clock.now());
    const writes: PlannedWrite[] = [
      await ctx.repo.planUpdate('billing_batch', batchId, (d) => {
        d.status = 'invoiced';
        d.invoice_ref = invoiceRef.trim();
        d.invoice_date = invoiceDate;
        d.invoiced_at = now;
        d.history.push({ at: now, action: 'invoiced', detail: invoiceRef.trim() });
      }),
    ];
    for (const id of b.entry_ids) {
      writes.push(
        await ctx.repo.planUpdate('time_entry', id, (d) => {
          if (d.billing_batch_id !== batchId)
            throw new DomainError(
              'batch_mismatch',
              msg(
                `Eintrag ${id} gehört nicht zu diesem Lauf`,
                `Entry ${id} does not belong to this batch`,
              ),
            );
          assertTimeTransition(d.billing_status, 'invoiced');
          d.billing_status = 'invoiced';
          d.history.push({
            at: now,
            action: 'billing_status',
            detail: `reserved → invoiced (${invoiceRef.trim()})`,
          });
        }),
      );
    }
    for (const id of b.expense_ids) {
      writes.push(
        await ctx.repo.planUpdate('expense', id, (d) => {
          assertExpenseTransition(d.billing_status, 'invoiced');
          d.billing_status = 'invoiced';
        }),
      );
    }
    await ctx.repo.commit(`invoice ${b.batch_number}`, writes);
  });
}

/** Payment data is only recorded explicitly; "paid revenue" is reported only from this. */
export async function recordPayment(
  ctx: AppContext,
  batchId: string,
  paidAt: IsoDate,
  paidCents: number,
): Promise<void> {
  if (!isIsoDate(paidAt))
    throw new ValidationError(msg('Zahlungsdatum ist ungültig', 'Payment date is invalid'));
  if (!Number.isSafeInteger(paidCents) || paidCents <= 0)
    throw new ValidationError(msg('Betrag ist ungültig', 'Amount is invalid'));
  await ctx.repo.update('billing_batch', batchId, (d) => {
    if (d.status !== 'invoiced')
      throw new DomainError(
        'not_invoiced',
        msg(
          'Zahlungen können nur für abgerechnete Läufe erfasst werden',
          'Payments can only be recorded for invoiced batches',
        ),
      );
    d.paid_at = paidAt;
    d.paid_cents = paidCents;
    d.history.push({
      at: toIso(ctx.clock.now()),
      action: 'payment',
      detail: `${paidAt}: ${paidCents} ct`,
    });
  });
}
