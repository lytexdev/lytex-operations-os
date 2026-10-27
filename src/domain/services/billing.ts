import type { BillingLine, Expense, Project, TimeEntry } from '../schemas/entities';
import {
  amountForSeconds,
  divRoundHalfUp,
  lineTotal,
  percentOf,
  sumCents,
} from '@/shared/money/money';
import { roundSeconds, type RoundingRule } from './rounding';
import { localDate, parseIso, type IsoDate } from '@/shared/date/time';
import { DomainError } from '../errors/errors';
import { msg } from '@/shared/i18n';

export interface BatchInput {
  entries: TimeEntry[];
  expenses: Expense[];
  projects: Map<string, Project>;
  rounding: RoundingRule;
  standardDaySeconds: number;
  periodFrom: IsoDate | null;
  periodTo: IsoDate | null;
  /** Include contractual fixed-price amount for these project IDs (explicit opt-in). */
  includeFixedPrice: string[];
  /** Include retainer monthly fee for these project IDs, for the number of months given. */
  retainerMonths: Record<string, number>;
  discountBasisPoints: number;
  ticketTitles?: Map<string, string>;
}

export interface BatchComputation {
  lines: BillingLine[];
  netCents: number;
  billedSeconds: number;
  rawSeconds: number;
  warnings: string[];
}

/** Entries eligible for a batch: billable, approved, not yet in a batch. */
export function isBatchEligible(e: TimeEntry): boolean {
  return e.billable && e.billing_status === 'approved' && !e.billing_batch_id && !e.archived;
}

export function isExpenseBatchEligible(e: Expense): boolean {
  return e.billing_status === 'approved' && !e.billing_batch_id && !e.archived;
}

/**
 * Compute billing lines. Rules:
 *  - Time & materials: one line per time entry, duration rounded per entry, entry's rate snapshot.
 *    Projects with billing_unit "day" are billed in days at the contractual daily rate
 *    (quantity = rounded seconds / standard day) – never automatically for "hour" projects.
 *  - Fixed price: time is NOT billed per hour; the contractual price is added only if explicitly selected.
 *  - Retainer: monthly fee line(s); hours beyond the included hours are billed at the entry rate.
 *  - Internal projects are never billed.
 */
export function computeBatch(input: BatchInput): BatchComputation {
  const lines: BillingLine[] = [];
  const warnings: string[] = [];
  let billedSeconds = 0;
  let rawSeconds = 0;

  const byProject = new Map<string, TimeEntry[]>();
  for (const e of input.entries) {
    if (!isBatchEligible(e))
      throw new DomainError(
        'batch_ineligible',
        msg(
          `Zeiteintrag ${e.id} ist nicht abrechenbar freigegeben`,
          `Time entry ${e.id} is not approved for billing`,
        ),
      );
    const list = byProject.get(e.project_id) ?? [];
    list.push(e);
    byProject.set(e.project_id, list);
  }

  for (const [projectId, entries] of byProject) {
    const project = input.projects.get(projectId);
    if (!project)
      throw new DomainError(
        'batch_missing_project',
        msg(`Projekt ${projectId} fehlt`, `Project ${projectId} is missing`),
      );
    entries.sort((a, b) => a.started_at.localeCompare(b.started_at));
    if (project.billing_model === 'internal') {
      throw new DomainError(
        'batch_internal',
        msg(
          `Projekt ${project.name} ist intern und nicht abrechenbar`,
          `Project ${project.name} is internal and not billable`,
        ),
      );
    }
    if (project.billing_model === 'fixed_price') {
      // Time on fixed price projects is documented with zero value.
      for (const e of entries) {
        rawSeconds += e.duration_seconds;
        lines.push({
          kind: 'time',
          description: entryDescription(
            e,
            input.ticketTitles,
            msg('(Festpreis, Nachweis)', '(fixed price, record only)'),
          ),
          quantity_milli: divRoundHalfUp(
            roundSeconds(e.duration_seconds, input.rounding) * 1000,
            3600,
          ),
          unit: msg('Std.', 'h'),
          unit_price_cents: 0,
          total_cents: 0,
          ref_ids: [e.id],
        });
      }
      continue;
    }

    let includedLeft =
      project.billing_model === 'retainer'
        ? (project.retainer_included_seconds ?? 0) * (input.retainerMonths[projectId] ?? 0)
        : 0;
    for (const e of entries) {
      rawSeconds += e.duration_seconds;
      const rounded = roundSeconds(e.duration_seconds, input.rounding);
      let chargeable = rounded;
      if (includedLeft > 0) {
        const covered = Math.min(includedLeft, Math.max(0, rounded));
        includedLeft -= covered;
        chargeable = rounded - covered;
        if (covered > 0) {
          lines.push({
            kind: 'time',
            description: entryDescription(
              e,
              input.ticketTitles,
              msg('(im Kontingent enthalten)', '(included in retainer)'),
            ),
            quantity_milli: divRoundHalfUp(covered * 1000, 3600),
            unit: msg('Std.', 'h'),
            unit_price_cents: 0,
            total_cents: 0,
            ref_ids: [e.id],
          });
        }
      }
      if (chargeable === 0) continue;
      billedSeconds += chargeable;
      if (project.billing_unit === 'day') {
        const dayRate = project.daily_rate_cents;
        if (dayRate == null)
          throw new DomainError(
            'batch_no_day_rate',
            msg(
              `Projekt ${project.name}: Tagessatz fehlt`,
              `Project ${project.name}: daily rate missing`,
            ),
          );
        const qty = divRoundHalfUp(chargeable * 1000, input.standardDaySeconds);
        lines.push({
          kind: 'time',
          description: entryDescription(e, input.ticketTitles),
          quantity_milli: qty,
          unit: msg('Tag', 'day'),
          unit_price_cents: dayRate,
          total_cents: lineTotal(qty, dayRate),
          ref_ids: [e.id],
        });
      } else {
        lines.push({
          kind: 'time',
          description: entryDescription(e, input.ticketTitles),
          quantity_milli: divRoundHalfUp(chargeable * 1000, 3600),
          unit: msg('Std.', 'h'),
          unit_price_cents: e.rate_cents,
          // Amount from exact seconds (not from the rounded quantity) to avoid double rounding.
          total_cents: amountForSeconds(Math.abs(chargeable), e.rate_cents) * Math.sign(chargeable),
          ref_ids: [e.id],
        });
      }
      if (e.rate_cents === 0)
        warnings.push(
          msg(`Zeiteintrag ${e.id} hat Stundensatz 0`, `Time entry ${e.id} has hourly rate 0`),
        );
    }
  }

  for (const pid of input.includeFixedPrice) {
    const p = input.projects.get(pid);
    if (!p || p.billing_model !== 'fixed_price' || p.fixed_price_cents == null) {
      throw new DomainError(
        'batch_fixed_price',
        msg(`Projekt ${pid} hat keinen Festpreis`, `Project ${pid} has no fixed price`),
      );
    }
    lines.push({
      kind: 'fixed_price',
      description: msg(`Festpreis: ${p.name}`, `Fixed price: ${p.name}`),
      quantity_milli: 1000,
      unit: msg('Pauschal', 'flat'),
      unit_price_cents: p.fixed_price_cents,
      total_cents: p.fixed_price_cents,
      ref_ids: [p.id],
    });
  }

  for (const [pid, months] of Object.entries(input.retainerMonths)) {
    if (months <= 0) continue;
    const p = input.projects.get(pid);
    if (!p || p.billing_model !== 'retainer' || p.retainer_monthly_fee_cents == null) {
      throw new DomainError(
        'batch_retainer',
        msg(`Projekt ${pid} hat keine Retainer-Pauschale`, `Project ${pid} has no retainer fee`),
      );
    }
    lines.push({
      kind: 'retainer',
      description: msg(`Retainer-Pauschale: ${p.name}`, `Retainer fee: ${p.name}`),
      quantity_milli: months * 1000,
      unit: msg('Monat', 'month'),
      unit_price_cents: p.retainer_monthly_fee_cents,
      total_cents: lineTotal(months * 1000, p.retainer_monthly_fee_cents),
      ref_ids: [p.id],
    });
  }

  for (const x of input.expenses) {
    if (!isExpenseBatchEligible(x))
      throw new DomainError(
        'batch_ineligible',
        msg(`Ausgabe ${x.id} ist nicht freigegeben`, `Expense ${x.id} is not approved`),
      );
    lines.push({
      kind: 'expense',
      description:
        msg('Auslage', 'Expense') +
        ` ${x.date}: ${x.description}${x.vendor ? ` (${x.vendor})` : ''}`,
      quantity_milli: 1000,
      unit: msg('Stk.', 'pcs'),
      unit_price_cents: x.amount_cents,
      total_cents: x.amount_cents,
      ref_ids: [x.id],
    });
  }

  if (input.discountBasisPoints > 0) {
    const base = sumCents(lines.map((l) => l.total_cents));
    const d = percentOf(base, input.discountBasisPoints);
    lines.push({
      kind: 'discount',
      description: msg(
        `Rabatt ${(input.discountBasisPoints / 100).toFixed(2).replace('.', ',')} %`,
        `Discount ${(input.discountBasisPoints / 100).toFixed(2)} %`,
      ),
      quantity_milli: 1000,
      unit: msg('Pauschal', 'flat'),
      unit_price_cents: -d,
      total_cents: -d,
      ref_ids: [],
    });
  }

  return {
    lines,
    netCents: sumCents(lines.map((l) => l.total_cents)),
    billedSeconds,
    rawSeconds,
    warnings,
  };
}

function entryDescription(
  e: TimeEntry,
  titles: Map<string, string> | undefined,
  suffix = '',
): string {
  const date = localDate(parseIso(e.started_at));
  const ticket = e.ticket_id ? titles?.get(e.ticket_id) : undefined;
  const parts = [date, ticket, e.description].filter(Boolean);
  return `${parts.join(' – ')}${suffix ? ` ${suffix}` : ''}`;
}
