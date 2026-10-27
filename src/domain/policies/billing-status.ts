import type {
  BatchStatus,
  BillingStatus,
  ExpenseBillingStatus,
  QuoteStatus,
} from '../schemas/entities';
import { TransitionError } from '../errors/errors';

/**
 * Explicit billing state machine for time entries.
 *  unbilled → approved → reserved (in a billing batch) → invoiced → adjusted
 *  unbilled/approved → written_off ; written_off → unbilled (reopen)
 *  approved → unbilled ; reserved → approved (batch cancelled / entry removed)
 */
const TIME_TRANSITIONS: Record<BillingStatus, BillingStatus[]> = {
  unbilled: ['approved', 'written_off'],
  approved: ['unbilled', 'reserved', 'written_off'],
  reserved: ['approved', 'invoiced'],
  invoiced: ['adjusted'],
  adjusted: [],
  written_off: ['unbilled'],
};

export function canTransitionTime(from: BillingStatus, to: BillingStatus): boolean {
  return TIME_TRANSITIONS[from].includes(to);
}

export function assertTimeTransition(from: BillingStatus, to: BillingStatus): void {
  if (!canTransitionTime(from, to)) throw new TransitionError(from, to);
}

/** Entries whose billing is in progress or finished must not be edited silently. */
export function isBillingLocked(status: BillingStatus): boolean {
  return status === 'reserved' || status === 'invoiced' || status === 'adjusted';
}

const EXPENSE_TRANSITIONS: Record<ExpenseBillingStatus, ExpenseBillingStatus[]> = {
  not_billable: ['unbilled'],
  unbilled: ['approved', 'written_off', 'not_billable'],
  approved: ['unbilled', 'reserved', 'written_off'],
  reserved: ['approved', 'invoiced'],
  invoiced: [],
  written_off: ['unbilled'],
};

export function assertExpenseTransition(
  from: ExpenseBillingStatus,
  to: ExpenseBillingStatus,
): void {
  if (!EXPENSE_TRANSITIONS[from].includes(to)) throw new TransitionError(from, to);
}

const BATCH_TRANSITIONS: Record<BatchStatus, BatchStatus[]> = {
  draft: ['exported', 'invoiced', 'cancelled'],
  exported: ['exported', 'invoiced', 'cancelled'],
  invoiced: [],
  cancelled: [],
};

export function assertBatchTransition(from: BatchStatus, to: BatchStatus): void {
  if (!BATCH_TRANSITIONS[from].includes(to)) throw new TransitionError(from, to);
}

const QUOTE_TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  draft: ['sent'],
  sent: ['accepted', 'rejected', 'expired', 'draft'],
  accepted: [],
  rejected: ['draft'],
  expired: ['draft'],
};

export function assertQuoteTransition(from: QuoteStatus, to: QuoteStatus): void {
  if (!QUOTE_TRANSITIONS[from].includes(to)) throw new TransitionError(from, to);
}

export function allowedQuoteTransitions(from: QuoteStatus): QuoteStatus[] {
  return QUOTE_TRANSITIONS[from];
}
