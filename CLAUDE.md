# CLAUDE.md – LYTEX Operations OS

Obsidian plugin (TypeScript + Svelte 5) for LYTEX business operations: CRM, projects, tickets, time
tracking, billing preparation, quotes, expenses, recurring work, dashboards. Data = Markdown notes with
YAML frontmatter under a configurable root folder (default `LYTEX OS/`).

**Current phase:** 0.3.0 – first public open-source release (MIT). Integrations limited to CSV; API keys for Lexware Office/OpenAI/DeepL can be stored but are unused. See
IMPLEMENTATION_STATUS.md for open items before starting work and update it when you finish.

## Commands

```bash
npm run check            # typecheck + lint + test + build (must pass before commit)
npm test                 # vitest
npm run test:perf        # benchmark
node scripts/deploy.mjs <vault>
```

## Architecture (see ARCHITECTURE.md)

`ui/` → `application/` (use-cases, queries) → `domain/` (schemas, policies, services; pure) →
`infrastructure/` (repository, index, journal, markdown, obsidian stores). `core/bootstrap/core.ts`
is the Obsidian-free composition root used by plugin, tests and scripts.

## Rules

- Domain/application code never imports `obsidian`.
- All writes go through `Repository` (validated, journaled, index-updated). Multi-file changes:
  `repo.exclusive` + `planCreate/planUpdate` + `repo.commit`.
- Never modify files outside the root folder. Preserve note bodies and unknown frontmatter keys.
- Never overwrite a file that failed to parse/validate; report it as an issue instead.
- Changing a schema → bump `SCHEMA_VERSION[type]` and add a migration in `infrastructure/migrations`.
- Every user-visible text exists in German and English: `t(key)` (keys in `shared/i18n/de.ts` + `en.ts`)
  or `msg(de, en)` for messages. No `{@html}`; derived values reading the index depend on `$version`.
- Never add personal data (names, customers, paths) to code, tests, docs or the example vault.

## Data invariants

- `id` and `type` are immutable; IDs are unique (duplicates are reported, secondary copy ignored).
- Times: UTC ISO instants; dates: local `YYYY-MM-DD`. Money: integer cents. Durations: integer seconds.
- `ticket.customer_id` equals its project's `customer_id`; tracked time is derived, never stored.

## Timer invariants

- Elapsed = Σ segment(end − start) from persisted timestamps. No counters.
- One session at a time; entry ID derived from session ID; commit = persist `stopping` → createIfAbsent →
  clear. Repeated stop is a no-op.
- Gaps (crash, stale heartbeat, suspend, forward clock jump) are never counted without user confirmation.

## Billing invariants

- Rate snapshot stored on each entry; never recomputed automatically.
- Only `approved` + billable + not-in-batch entries can be batched; eligibility is re-checked inside the
  write lock. Export does not change state; invoicing needs an explicit invoice reference.
- `reserved/invoiced/adjusted` entries are locked; corrections via adjustment entries.
- Daily rates only for projects with `billing_unit: day`; internal projects never billable.

## Security

No network code, no telemetry, no secrets in notes/frontmatter/settings. Credentials (future integrations)
only via `app.secretStorage`, integrations disabled by default. Never commit customer data.

## Definition of Done (for changes)

Code + tests (domain/persistence/timer/billing as relevant) + `npm run check` green + docs updated
(DATA_MODEL for schema changes, CHANGELOG, IMPLEMENTATION_STATUS) + for UI changes: verified in Obsidian
(test vault) or listed as unverified.
