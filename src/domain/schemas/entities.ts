import { z } from 'zod';
import {
  baseFields,
  zAddress,
  zCents,
  zCurrency,
  zDate,
  zHistoryItem,
  zInstant,
  zOptCents,
  zOptDate,
  zOptInstant,
  zOptRef,
  zOptSeconds,
  zPriority,
  zRef,
  zRefs,
  zSeconds,
  zStr,
} from './common';
import { msg } from '@/shared/i18n';

export const SCHEMA_VERSION = {
  customer: 1,
  contact: 1,
  interaction: 1,
  project: 1,
  ticket: 2,
  time_entry: 1,
  billing_batch: 1,
  quote: 1,
  expense: 1,
  recurring_task: 1,
  service: 1,
} as const;

export type EntityType = keyof typeof SCHEMA_VERSION;

/** Project key: 2–10 chars, uppercase letters/digits, single hyphens allowed inside (e.g. LTX-B). */
export const PROJECT_KEY_RE = /^(?=.{2,10}$)[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/;
export const projectKeyMessage = (): string =>
  msg(
    'Kürzel: 2–10 Zeichen, Großbuchstaben/Ziffern und Bindestriche (z. B. LTX-B), beginnend mit Buchstabe',
    'Key: 2–10 characters, uppercase letters/digits and hyphens (e.g. LTX-B), starting with a letter',
  );
export const ENTITY_TYPES = Object.keys(SCHEMA_VERSION) as EntityType[];

// ---------------------------------------------------------------- CRM
export const CUSTOMER_STATUSES = ['lead', 'active', 'inactive', 'archived'] as const;
export const CustomerSchema = z.object({
  ...baseFields,
  type: z.literal('customer'),
  customer_number: zStr,
  name: z.string().min(1, { error: () => msg('Name ist erforderlich', 'Name is required') }),
  customer_kind: z.enum(['business', 'private']).default('business'),
  status: z.enum(CUSTOMER_STATUSES).default('active'),
  website: zStr.default(''),
  email: zStr.default(''),
  phone: zStr.default(''),
  address: zAddress,
  billing_address: zAddress.nullable().default(null),
  vat_id: zStr.default(''),
  tax_number: zStr.default(''),
  external_accounting_id: zStr.default(''),
  default_rate_cents: zOptCents,
  currency: zCurrency,
  payment_terms_days: z.number().int().min(0).max(365).default(14),
  password_manager_ref: zStr.default(''),
});
export type Customer = z.infer<typeof CustomerSchema>;

export const ContactSchema = z.object({
  ...baseFields,
  type: z.literal('contact'),
  customer_id: zRef,
  first_name: zStr.default(''),
  last_name: z
    .string()
    .min(1, { error: () => msg('Nachname ist erforderlich', 'Last name is required') }),
  role: zStr.default(''),
  email: zStr.default(''),
  phone: zStr.default(''),
  primary: z.boolean().default(false),
});
export type Contact = z.infer<typeof ContactSchema>;

export const INTERACTION_KINDS = ['call', 'email', 'meeting', 'note', 'other'] as const;
export const InteractionSchema = z.object({
  ...baseFields,
  type: z.literal('interaction'),
  customer_id: zRef,
  project_id: zOptRef,
  contact_ids: zRefs,
  kind: z.enum(INTERACTION_KINDS).default('note'),
  occurred_at: zInstant,
  subject: z
    .string()
    .min(1, { error: () => msg('Betreff ist erforderlich', 'Subject is required') }),
  follow_up_date: zOptDate,
});
export type Interaction = z.infer<typeof InteractionSchema>;

// ---------------------------------------------------------------- Projects
export const PROJECT_STATUSES = ['planned', 'active', 'on_hold', 'completed', 'cancelled'] as const;
export const BILLING_MODELS = [
  'time_and_materials',
  'fixed_price',
  'retainer',
  'internal',
] as const;
export type BillingModel = (typeof BILLING_MODELS)[number];

export const ProjectSchema = z.object({
  ...baseFields,
  type: z.literal('project'),
  project_number: zStr,
  key: z.string().regex(PROJECT_KEY_RE, { error: projectKeyMessage }),
  customer_id: zOptRef,
  name: z
    .string()
    .min(1, { error: () => msg('Projektname ist erforderlich', 'Project name is required') }),
  status: z.enum(PROJECT_STATUSES).default('active'),
  priority: zPriority,
  start_date: zOptDate,
  deadline: zOptDate,
  completed_date: zOptDate,
  billing_model: z.enum(BILLING_MODELS).default('time_and_materials'),
  service_id: zOptRef,
  /** Contract/project-specific hourly rate (highest precedence). */
  rate_cents: zOptCents,
  /** Contractual daily rate. Only applied when billing_unit is "day". */
  daily_rate_cents: zOptCents,
  billing_unit: z.enum(['hour', 'day']).default('hour'),
  fixed_price_cents: zOptCents,
  retainer_monthly_fee_cents: zOptCents,
  retainer_included_seconds: zOptSeconds,
  /** Contractual customer budget (money and/or time). */
  budget_cents: zOptCents,
  budget_seconds: zOptSeconds,
  /** Internal effort estimate (not contractual). */
  estimated_seconds: zOptSeconds,
  /** Internal cost rate used for profitability (what an hour costs LYTEX). */
  internal_cost_rate_cents: zOptCents,
  currency: zCurrency,
  milestones: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        due_date: zOptDate,
        done: z.boolean().default(false),
      }),
    )
    .default([]),
  doc_links: z.array(z.string()).default([]),
});
export type Project = z.infer<typeof ProjectSchema>;

// ---------------------------------------------------------------- Tickets
export const TicketSchema = z.object({
  ...baseFields,
  type: z.literal('ticket'),
  ticket_number: zStr,
  project_id: zRef,
  customer_id: zOptRef,
  title: z.string().min(1, { error: () => msg('Titel ist erforderlich', 'Title is required') }),
  status: z.string().min(1).default('backlog'),
  priority: zPriority,
  category: zStr.default(''),
  due_date: zOptDate,
  estimated_seconds: zOptSeconds,
  billable: z.boolean().default(true),
  /** Assigned people (names from the team list or free text). */
  assignees: z.array(z.string()).default([]),
  parent_id: zOptRef,
  depends_on: zRefs,
  checklist: z
    .array(
      z.object({
        id: z.string(),
        text: z.string(),
        done: z.boolean().default(false),
        required: z.boolean().default(false),
      }),
    )
    .default([]),
  activity: z.array(zHistoryItem).default([]),
  completed_at: zOptInstant,
  sort_order: z.number().default(0),
  recurring_task_id: zOptRef,
  occurrence_key: zStr.default(''),
  service_id: zOptRef,
});
export type Ticket = z.infer<typeof TicketSchema>;
export type ChecklistItem = Ticket['checklist'][number];

// ---------------------------------------------------------------- Time
export const BILLING_STATUSES = [
  'unbilled',
  'approved',
  'reserved',
  'invoiced',
  'adjusted',
  'written_off',
] as const;
export type BillingStatus = (typeof BILLING_STATUSES)[number];
export const TIME_SOURCES = ['timer', 'manual', 'recovery', 'adjustment', 'import'] as const;

export const zSegment = z.object({ start: zInstant, end: zInstant });
export type Segment = z.infer<typeof zSegment>;

export const TimeEntrySchema = z
  .object({
    ...baseFields,
    type: z.literal('time_entry'),
    session_id: zOptRef,
    customer_id: zOptRef,
    project_id: zRef,
    ticket_id: zOptRef,
    service_id: zOptRef,
    description: zStr.default(''),
    started_at: zInstant,
    ended_at: zInstant,
    /** Net worked seconds (sum of segments). Negative only for adjustments. */
    duration_seconds: z.number().int(),
    segments: z.array(zSegment).default([]),
    billable: z.boolean(),
    /** Hourly rate snapshot at creation time. Never recalculated automatically. */
    rate_cents: zCents.nonnegative(),
    rate_source: z.enum(['project', 'customer', 'service', 'default', 'manual']).default('default'),
    currency: zCurrency,
    billing_status: z.enum(BILLING_STATUSES).default('unbilled'),
    billing_batch_id: zOptRef,
    source: z.enum(TIME_SOURCES).default('manual'),
    adjusts_entry_id: zOptRef,
    overlap_acknowledged: z.boolean().default(false),
    history: z.array(zHistoryItem).default([]),
  })
  .superRefine((e, ctx) => {
    if (e.source !== 'adjustment') {
      if (e.duration_seconds < 0)
        ctx.addIssue({
          code: 'custom',
          message: msg('Dauer darf nicht negativ sein', 'Duration must not be negative'),
          path: ['duration_seconds'],
        });
      if (Date.parse(e.ended_at) < Date.parse(e.started_at))
        ctx.addIssue({
          code: 'custom',
          message: msg('Ende liegt vor dem Beginn', 'End is before start'),
          path: ['ended_at'],
        });
    } else if (!e.adjusts_entry_id) {
      ctx.addIssue({
        code: 'custom',
        message: msg('Korrekturbuchung ohne Bezug', 'Adjustment without reference'),
        path: ['adjusts_entry_id'],
      });
    }
  });
export type TimeEntry = z.infer<typeof TimeEntrySchema>;

// ---------------------------------------------------------------- Billing
export const BATCH_STATUSES = ['draft', 'exported', 'invoiced', 'cancelled'] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];
export const LINE_KINDS = [
  'time',
  'expense',
  'fixed_price',
  'retainer',
  'discount',
  'manual',
] as const;

export const zLine = z.object({
  kind: z.enum(LINE_KINDS),
  description: z.string(),
  /** Quantity in thousandths (1,5 h = 1500). */
  quantity_milli: z.number().int(),
  unit: z.string().default('Std.'),
  unit_price_cents: zCents,
  total_cents: zCents,
  ref_ids: zRefs,
});
export type BillingLine = z.infer<typeof zLine>;

export const BillingBatchSchema = z.object({
  ...baseFields,
  type: z.literal('billing_batch'),
  batch_number: zStr,
  customer_id: zOptRef,
  project_ids: zRefs,
  period_from: zOptDate,
  period_to: zOptDate,
  status: z.enum(BATCH_STATUSES).default('draft'),
  currency: zCurrency,
  entry_ids: zRefs,
  expense_ids: zRefs,
  lines: z.array(zLine).default([]),
  net_cents: zCents.default(0),
  rounding: z.object({
    unit_minutes: z.number().int().min(1),
    mode: z.enum(['none', 'up', 'nearest', 'down']),
  }),
  exports: z
    .array(z.object({ at: zInstant, path: z.string(), format: z.string(), rows: z.number().int() }))
    .default([]),
  invoice_ref: zStr.default(''),
  invoice_date: zOptDate,
  invoiced_at: zOptInstant,
  paid_at: zOptDate,
  paid_cents: zOptCents,
  history: z.array(zHistoryItem).default([]),
});
export type BillingBatch = z.infer<typeof BillingBatchSchema>;

export const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'expired'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];
export const QuoteSchema = z.object({
  ...baseFields,
  type: z.literal('quote'),
  quote_number: zStr,
  customer_id: zRef,
  project_id: zOptRef,
  title: z.string().min(1, { error: () => msg('Titel ist erforderlich', 'Title is required') }),
  status: z.enum(QUOTE_STATUSES).default('draft'),
  issue_date: zDate,
  valid_until: zOptDate,
  currency: zCurrency,
  lines: z
    .array(
      z.object({
        description: z.string(),
        quantity_milli: z.number().int(),
        unit: z.string().default('Std.'),
        unit_price_cents: zCents,
      }),
    )
    .default([]),
  discount_bp: z.number().int().min(0).max(10000).default(0),
  history: z.array(zHistoryItem).default([]),
});
export type Quote = z.infer<typeof QuoteSchema>;

export const EXPENSE_BILLING_STATUSES = [
  'not_billable',
  'unbilled',
  'approved',
  'reserved',
  'invoiced',
  'written_off',
] as const;
export type ExpenseBillingStatus = (typeof EXPENSE_BILLING_STATUSES)[number];
export const ExpenseSchema = z.object({
  ...baseFields,
  type: z.literal('expense'),
  customer_id: zOptRef,
  project_id: zOptRef,
  date: zDate,
  vendor: zStr.default(''),
  description: z
    .string()
    .min(1, { error: () => msg('Beschreibung ist erforderlich', 'Description is required') }),
  category: zStr.default(''),
  amount_cents: zCents.positive({
    error: () => msg('Betrag muss größer als 0 sein', 'Amount must be greater than 0'),
  }),
  currency: zCurrency,
  reimbursable: z.boolean().default(false),
  billing_status: z.enum(EXPENSE_BILLING_STATUSES).default('not_billable'),
  billing_batch_id: zOptRef,
  receipt: zStr.default(''),
});
export type Expense = z.infer<typeof ExpenseSchema>;

// ---------------------------------------------------------------- Operations
export const RecurrenceSchema = z.object({
  freq: z.enum(['daily', 'weekly', 'monthly', 'interval_days']),
  interval: z.number().int().min(1).max(366).default(1),
  /** 1 = Monday … 7 = Sunday; weekly only. */
  weekdays: z.array(z.number().int().min(1).max(7)).default([]),
  /** monthly only; clamped to month length. */
  day_of_month: z.number().int().min(1).max(31).nullable().default(null),
});
export type Recurrence = z.infer<typeof RecurrenceSchema>;

export const RecurringTaskSchema = z.object({
  ...baseFields,
  type: z.literal('recurring_task'),
  title: z.string().min(1, { error: () => msg('Titel ist erforderlich', 'Title is required') }),
  customer_id: zOptRef,
  project_id: zRef,
  service_id: zOptRef,
  recurrence: RecurrenceSchema,
  start_date: zDate,
  end_date: zOptDate,
  /** Highest occurrence date already materialized (inclusive). */
  generated_through: zOptDate,
  lead_days: z.number().int().min(0).max(90).default(7),
  estimated_seconds: zOptSeconds,
  priority: zPriority,
  billable: z.boolean().default(true),
  active: z.boolean().default(true),
  category: zStr.default('Wartung'),
  checklist: z.array(z.string()).default([]),
});
export type RecurringTask = z.infer<typeof RecurringTaskSchema>;

export const ServiceSchema = z.object({
  ...baseFields,
  type: z.literal('service'),
  name: z.string().min(1, { error: () => msg('Name ist erforderlich', 'Name is required') }),
  rate_cents: zOptCents,
  billable: z.boolean().default(true),
  description: zStr.default(''),
});
export type Service = z.infer<typeof ServiceSchema>;

export const SCHEMAS = {
  customer: CustomerSchema,
  contact: ContactSchema,
  interaction: InteractionSchema,
  project: ProjectSchema,
  ticket: TicketSchema,
  time_entry: TimeEntrySchema,
  billing_batch: BillingBatchSchema,
  quote: QuoteSchema,
  expense: ExpenseSchema,
  recurring_task: RecurringTaskSchema,
  service: ServiceSchema,
} as const;

export interface EntityMap {
  customer: Customer;
  contact: Contact;
  interaction: Interaction;
  project: Project;
  ticket: Ticket;
  time_entry: TimeEntry;
  billing_batch: BillingBatch;
  quote: Quote;
  expense: Expense;
  recurring_task: RecurringTask;
  service: Service;
}
export type AnyEntity = EntityMap[EntityType];

/** Fields every entity has; everything else is type specific. */
export type EntityBase = Pick<
  Customer,
  'schema_version' | 'id' | 'created_at' | 'updated_at' | 'archived' | 'tags'
>;

export type NewEntity<T extends EntityType> = Omit<EntityMap[T], keyof EntityBase | 'type'> &
  Partial<Pick<EntityBase, 'tags'>>;

export { zSeconds, zDate, zInstant };
export { CURRENCIES } from './common';
