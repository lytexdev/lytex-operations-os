import { OpsCore } from '@/core/bootstrap/core';
import { DEFAULT_SETTINGS, type LytexSettings } from '@/core/configuration/settings';
import { MemoryFileStore, MemoryRawStore } from '@/infrastructure/persistence/memory-store';
import type { Clock } from '@/shared/date/time';
import { createCustomer } from '@/application/use-cases/crm';
import { createProject, type ProjectInput } from '@/application/use-cases/projects';
import { createTicket } from '@/application/use-cases/tickets';

export class FakeClock implements Clock {
  wall: number;
  mono = 1000;
  constructor(iso = '2026-10-23T08:00:00Z') {
    this.wall = Date.parse(iso);
  }
  now(): number {
    return this.wall;
  }
  monotonic(): number {
    return this.mono;
  }
  /** Normal passage of time (both clocks advance). */
  advance(ms: number): void {
    this.wall += ms;
    this.mono += ms;
  }
  /** Suspend: wall clock advances, monotonic does not. */
  suspend(ms: number): void {
    this.wall += ms;
  }
  jumpWall(ms: number): void {
    this.wall += ms;
  }
  /** Simulates a process restart (monotonic clock origin resets). */
  restartProcess(): void {
    this.mono = 1000;
  }
}

export interface TestEnv {
  core: OpsCore;
  files: MemoryFileStore;
  raw: MemoryRawStore;
  clock: FakeClock;
  settings: LytexSettings;
}

export async function makeEnv(
  opts: {
    files?: MemoryFileStore;
    raw?: MemoryRawStore;
    clock?: FakeClock;
    settings?: Partial<LytexSettings>;
  } = {},
): Promise<TestEnv> {
  const files = opts.files ?? new MemoryFileStore();
  const raw = opts.raw ?? new MemoryRawStore();
  const clock = opts.clock ?? new FakeClock();
  const settings: LytexSettings = {
    ...structuredClone(DEFAULT_SETTINGS),
    // Fictional test team (the shipped defaults are empty).
    team: ['Alex Beispiel', 'Sam Muster'],
    me: 'Alex Beispiel',
    defaultAssignee: 'Alex Beispiel',
    ...(opts.settings ?? {}),
  };
  const core = new OpsCore(files, raw, () => settings, clock);
  await core.start({ reconcile: false });
  return { core, files, raw, clock, settings };
}

/** Simulate an app restart on the same storage. */
export async function restart(env: TestEnv): Promise<TestEnv> {
  env.clock.restartProcess();
  return makeEnv({ files: env.files, raw: env.raw, clock: env.clock, settings: env.settings });
}

export async function seedBasic(env: TestEnv, project: Partial<ProjectInput> = {}) {
  const ctx = env.core.ctx;
  const customer = await createCustomer(ctx, {
    name: 'Muster GmbH',
    customer_kind: 'business',
    status: 'active',
    website: 'https://muster.example',
    email: 'info@muster.example',
    phone: '',
    address: { street: 'Hauptstr. 1', zip: '12345', city: 'Musterstadt', country: 'DE' },
    billing_address: null,
    vat_id: '',
    tax_number: '',
    external_accounting_id: '',
    default_rate_cents: null,
    currency: 'EUR',
    payment_terms_days: 14,
    password_manager_ref: '',
  });
  const p = await createProject(ctx, {
    customer_id: customer.id,
    name: 'Website Relaunch',
    status: 'active',
    priority: 'normal',
    start_date: null,
    deadline: null,
    completed_date: null,
    billing_model: 'time_and_materials',
    service_id: null,
    rate_cents: null,
    daily_rate_cents: null,
    billing_unit: 'hour',
    fixed_price_cents: null,
    retainer_monthly_fee_cents: null,
    retainer_included_seconds: null,
    budget_cents: null,
    budget_seconds: null,
    estimated_seconds: null,
    internal_cost_rate_cents: null,
    currency: 'EUR',
    milestones: [],
    doc_links: [],
    ...project,
  });
  const ticket = await createTicket(ctx, {
    project_id: p.id,
    title: 'Startseite umsetzen',
    status: 'todo',
    priority: 'normal',
    category: 'Entwicklung',
    due_date: null,
    estimated_seconds: 7200,
    billable: true,
    assignees: ['Alex Beispiel'],
    parent_id: null,
    depends_on: [],
    checklist: [],
    sort_order: 0,
    recurring_task_id: null,
    occurrence_key: '',
    service_id: null,
  });
  return { customer, project: p, ticket };
}

export const H = 3600_000;
export const MIN = 60_000;
