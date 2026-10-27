import type { Customer, Project, Service } from '../schemas/entities';

export type RateSource = 'project' | 'customer' | 'service' | 'default';

export interface ResolvedRate {
  rate_cents: number;
  source: RateSource;
}

/**
 * Rate precedence (highest first):
 *  1. contract/project-specific rate
 *  2. customer-specific rate
 *  3. service-specific rate (ticket service, then project service)
 *  4. global default rate
 */
export function resolveHourlyRate(input: {
  project?: Pick<Project, 'rate_cents'> | null;
  customer?: Pick<Customer, 'default_rate_cents'> | null;
  service?: Pick<Service, 'rate_cents'> | null;
  defaultRateCents: number;
}): ResolvedRate {
  if (input.project?.rate_cents != null)
    return { rate_cents: input.project.rate_cents, source: 'project' };
  if (input.customer?.default_rate_cents != null)
    return { rate_cents: input.customer.default_rate_cents, source: 'customer' };
  if (input.service?.rate_cents != null)
    return { rate_cents: input.service.rate_cents, source: 'service' };
  return { rate_cents: input.defaultRateCents, source: 'default' };
}

/** Whether time on a project is billable by default (internal projects never are). */
export function defaultBillable(
  project: Pick<Project, 'billing_model'>,
  ticketBillable?: boolean,
  serviceBillable?: boolean,
): boolean {
  if (project.billing_model === 'internal') return false;
  if (ticketBillable === false) return false;
  if (serviceBillable === false) return false;
  return true;
}
