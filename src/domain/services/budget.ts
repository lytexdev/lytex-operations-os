import type { Project } from '../schemas/entities';
import { amountForSeconds } from '@/shared/money/money';
import { msg } from '@/shared/i18n';

export interface ProjectTimeTotals {
  trackedSeconds: number;
  billableSeconds: number;
  nonBillableSeconds: number;
  /** Value of billable entries at their rate snapshots (before rounding). */
  billableValueCents: number;
  invoicedValueCents: number;
  expensesCents: number;
}

export interface BudgetStatus {
  kind: 'money' | 'time' | 'estimate';
  label: string;
  used: number;
  total: number;
  ratio: number;
  /** Highest threshold (percent) reached, or null. */
  reachedThreshold: number | null;
}

export function evaluateBudgets(
  project: Project,
  totals: ProjectTimeTotals,
  thresholds: number[],
): BudgetStatus[] {
  const out: BudgetStatus[] = [];
  const sorted = [...thresholds].sort((a, b) => a - b);
  const reached = (ratio: number): number | null => {
    let r: number | null = null;
    for (const t of sorted) if (ratio * 100 >= t) r = t;
    return r;
  };
  const moneyBudget =
    project.billing_model === 'fixed_price'
      ? (project.budget_cents ?? project.fixed_price_cents)
      : project.budget_cents;
  if (moneyBudget != null && moneyBudget > 0) {
    // For fixed price projects the "used" value is the internal value of all tracked time.
    const used =
      project.billing_model === 'fixed_price'
        ? amountForSeconds(
            totals.trackedSeconds,
            project.internal_cost_rate_cents ?? project.rate_cents ?? 0,
          )
        : totals.billableValueCents + totals.expensesCents;
    const ratio = used / moneyBudget;
    out.push({
      kind: 'money',
      label: msg('Budget (vertraglich)', 'Budget (contractual)'),
      used,
      total: moneyBudget,
      ratio,
      reachedThreshold: reached(ratio),
    });
  }
  if (project.budget_seconds != null && project.budget_seconds > 0) {
    const used =
      project.billing_model === 'internal' ? totals.trackedSeconds : totals.billableSeconds;
    const ratio = used / project.budget_seconds;
    out.push({
      kind: 'time',
      label: msg('Zeitbudget (vertraglich)', 'Time budget (contractual)'),
      used,
      total: project.budget_seconds,
      ratio,
      reachedThreshold: reached(ratio),
    });
  }
  if (project.estimated_seconds != null && project.estimated_seconds > 0) {
    const ratio = totals.trackedSeconds / project.estimated_seconds;
    out.push({
      kind: 'estimate',
      label: msg('Interne Schätzung', 'Internal estimate'),
      used: totals.trackedSeconds,
      total: project.estimated_seconds,
      ratio,
      reachedThreshold: reached(ratio),
    });
  }
  return out;
}

export interface Profitability {
  revenueCents: number;
  revenueBasis: 'invoiced' | 'fixed_price' | 'billable_value';
  internalCostCents: number;
  marginCents: number;
  /** Revenue per tracked hour in cents, null when nothing tracked. */
  effectiveHourlyCents: number | null;
}

/**
 * Project profitability. Revenue basis:
 *  - fixed price: the contractual price
 *  - otherwise: billable value of tracked time (projected), plus expenses
 * Internal cost = tracked seconds × internal cost rate (if configured, else 0).
 */
export function profitability(
  project: Project,
  totals: ProjectTimeTotals,
  defaultCostRateCents: number | null,
): Profitability {
  let revenueCents: number;
  let revenueBasis: Profitability['revenueBasis'];
  if (project.billing_model === 'fixed_price' && project.fixed_price_cents != null) {
    revenueCents = project.fixed_price_cents;
    revenueBasis = 'fixed_price';
  } else {
    revenueCents = totals.billableValueCents;
    revenueBasis = 'billable_value';
  }
  const costRate = project.internal_cost_rate_cents ?? defaultCostRateCents ?? 0;
  const internalCostCents = amountForSeconds(totals.trackedSeconds, costRate);
  const effectiveHourlyCents =
    totals.trackedSeconds > 0 ? Math.round((revenueCents * 3600) / totals.trackedSeconds) : null;
  return {
    revenueCents,
    revenueBasis,
    internalCostCents,
    marginCents: revenueCents - internalCostCents,
    effectiveHourlyCents,
  };
}
