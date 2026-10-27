# Data model

All entities: `type`, `schema_version`, immutable `id` (`<PREFIX>-<ULID>`), `created_at`, `updated_at`
(UTC ISO-8601), `archived`, `tags`. Money: integer **cents** (`*_cents`). Durations: integer **seconds**
(`*_seconds`). Dates: local calendar `YYYY-MM-DD`. Instants: UTC `…Z`. Schemas: `src/domain/schemas/entities.ts`.

| Type           | Prefix | Location (default, informational only)                                | Human number        |
| -------------- | ------ | --------------------------------------------------------------------- | ------------------- |
| customer       | CUS    | `01 CRM/Customers/`                                                   | `K-0001`            |
| contact        | CON    | `01 CRM/Contacts/`                                                    | –                   |
| interaction    | INT    | `01 CRM/Interactions/` or `<project>/Meetings/`                       | –                   |
| project        | PRJ    | `02 Projects/<P-0001 Name>/Project.md`                                | `P-0001`, key `WEB` |
| ticket         | TKT    | `<project>/Tickets/`                                                  | `<KEY>-<n>`         |
| time_entry     | TIM    | `03 Time/Entries/YYYY/MM/<id>.md`, adjustments `03 Time/Adjustments/` | –                   |
| billing_batch  | BAT    | `04 Finance/Billing-Batches/`                                         | `AB-YYYY-001`       |
| quote          | QUO    | `04 Finance/Quotes/`                                                  | `AN-YYYY-001`       |
| expense        | EXP    | `04 Finance/Expenses/YYYY/`                                           | –                   |
| recurring_task | REC    | `05 Operations/Recurring Tasks/`                                      | –                   |
| service        | SRV    | `07 Configuration/Services/`                                          | –                   |

Files may be renamed or moved freely; identity is the `id`. Numbers are derived from existing data
(max + 1), not from counters.

## Key fields & rules

- **customer**: name, customer_kind (business/private), status (lead/active/inactive/archived), contact
  data, address, billing_address, vat_id, tax_number, external_accounting_id, default_rate_cents,
  currency, payment_terms_days, password_manager_ref (reference only).
- **project**: customer_id (null = internal), billing_model (`time_and_materials`, `fixed_price`,
  `retainer`, `internal`), rate_cents, billing_unit (`hour`/`day`) + daily_rate_cents, fixed_price_cents,
  retainer_monthly_fee_cents + retainer_included_seconds, **contractual** budget_cents/budget_seconds,
  **internal** estimated_seconds and internal_cost_rate_cents, milestones, doc_links.
- **ticket**: project_id, customer_id (derived from project, validated), status (workflow key), priority,
  category, due_date, estimated_seconds, billable, assignees (list of names; schema v2, v1 had a single `assignee` string), parent_id, depends_on, checklist
  (`{id,text,done,required}`), activity (history + comments), completed_at, occurrence_key (recurring).
  Tracked time is derived from time entries, never stored.
- **time_entry**: session_id, project_id, ticket_id, customer_id, started_at, ended_at,
  duration_seconds (net; negative only for adjustments), segments, billable, **rate_cents snapshot** +
  rate_source, billing_status, billing_batch_id, source (`timer`, `manual`, `recovery`, `adjustment`),
  adjusts_entry_id, overlap_acknowledged, history.
- **billing_batch**: customer_id, project_ids, period, status, entry_ids, expense_ids, lines (kind,
  description, quantity_milli, unit, unit_price_cents, total_cents, ref_ids), net_cents, rounding snapshot,
  exports, invoice_ref/date, invoiced_at, paid_at/paid_cents, history.

## State machines

- Time entry billing: `unbilled → approved → reserved → invoiced → adjusted`; `unbilled/approved →
written_off → unbilled`; `approved → unbilled`; `reserved → approved` (batch cancelled).
  `reserved/invoiced/adjusted` entries cannot be edited – use an adjustment.
- Batch: `draft → exported → invoiced`, `draft/exported → cancelled`.
- Quote: `draft → sent → accepted | rejected | expired`; `sent/rejected/expired → draft`.
- Expense: `not_billable ⇄ unbilled → approved → reserved → invoiced`, `written_off`.
- Ticket workflow: configurable statuses with category `open | active | blocked | done | cancelled`.
  Default: backlog, todo, in_progress, review, done, cancelled. Manual order via `sort_order` (10, 20, …).

## Rate precedence

1. project/contract `rate_cents` 2. customer `default_rate_cents` 3. service `rate_cents` (ticket service,
   then project service) 4. global default (70,00 €). The resolved rate and its source are stored in every
   entry; later rate changes never modify existing entries. Internal projects are never billable.

## Metrics (Kennzahlen)

| Metric                             | Definition                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------- |
| Tracked time                       | All non-archived time entries (billable and non-billable)                   |
| Billable time                      | Entries with `billable = true` and not written off                          |
| Approved time                      | Billable entries in `approved`, `reserved`, `invoiced`, `adjusted`          |
| Billable value / projected revenue | duration × rate snapshot (unrounded) of billable entries                    |
| Unbilled value                     | Billable value of entries in `unbilled` + `approved`                        |
| Invoiced revenue                   | `net_cents` of batches in status `invoiced` (by invoice date)               |
| Paid revenue                       | Only batches with explicitly recorded `paid_cents`                          |
| Effective hourly revenue           | revenue basis × 3600 / tracked seconds                                      |
| Internal cost                      | tracked seconds × internal cost rate (project, else global setting, else 0) |
