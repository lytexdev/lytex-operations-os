# Architecture

```text
ui/ (Svelte 5 views, forms, Obsidian ItemViews/Modals/Settings)      ─ presentation
  │  uses UiApi (ui/stores/ui-api.ts) – never touches files directly
application/ (use-cases, queries, AppContext)                         ─ application
  │
domain/ (schemas, policies, services: timer, billing, rates, …)       ─ domain (pure, no Obsidian)
  │
infrastructure/ (repository, index, journal, markdown, migrations,    ─ adapters
                 obsidian vault stores, timer adapters, integrations)
  │
Obsidian Vault API / plugin data folder                               ─ storage
```

`core/bootstrap/core.ts` (`OpsCore`) is the composition root. It has no Obsidian dependency: the plugin
(`src/main.ts`) injects `VaultFileStore`/`PluginRawStore`; tests inject `MemoryFileStore`/`MemoryRawStore`
with failure injection; scripts inject `NodeFileStore`. The same startup path (journal recovery → index
build → timer load → recurring reconciliation) runs everywhere.

## Source layout

| Path                              | Responsibility                                                                                             |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `src/shared/`                     | ULID/IDs, money (integer cents), date/time (UTC instants, local calendar math), i18n, mutex, hashing, text |
| `src/domain/schemas/`             | Zod schemas = single source of truth for entity shapes and versions                                        |
| `src/domain/policies/`            | Ticket workflow + Definition of Done, billing/quote/batch state machines                                   |
| `src/domain/services/`            | Timer engine, billing computation, rates, rounding, budgets, recurrence, overlaps, duplicates, CSV         |
| `src/application/use-cases/`      | CRM, projects, tickets, time, billing, finance, recurring                                                  |
| `src/application/queries/`        | Memoized aggregates (per index version), search, ticket filters, timelines                                 |
| `src/infrastructure/persistence/` | `FileStore`/`RawStore` interfaces, repository, journal, durable JSON, path policy                          |
| `src/infrastructure/indexing/`    | `EntityIndex` – derived, disposable in-memory index + integrity checks                                     |
| `src/infrastructure/markdown/`    | Frontmatter codec, initial note bodies, generated overview notes                                           |
| `src/infrastructure/obsidian/`    | Vault-backed stores                                                                                        |
| `src/ui/`                         | Views, forms, components, router, styles live in `styles.css`                                              |

## Persistence

- **Markdown files are authoritative.** Each entity is one note; the plugin rewrites only the
  frontmatter of its own notes and preserves the body and unknown frontmatter keys.
- **Index**: built at startup from Obsidian's metadata cache (fast path, ~0.5 s for 55 600 entities)
  or by parsing files; kept current via vault `create/modify/delete/rename` and metadata `changed` events.
  Corrupt YAML, schema violations, duplicate IDs (e.g. copied notes, sync conflict copies), newer schema
  versions and broken references become _issues_ shown in _Datenprüfung_; affected files are ignored,
  never overwritten.
- **Writes** are serialized through one mutex. Updates re-read the file; if the content hash or the
  caller's `updated_at` differs, a `ConflictError` is raised (optimistic concurrency).
- **Write-ahead journal** (`state/journal.{a,b}.json`): every operation (single or multi-file) records
  the full target content of every file before writing. On startup, pending operations are rolled
  forward: already applied → skip; untouched or truncated → rewrite; changed by someone else →
  _not_ overwritten, conflict copy saved to `state/conflicts/` and reported. Multi-file operations
  (billing batch creation/cancel/invoice, adjustments, recurring generation) therefore complete after a
  crash. Obsidian's `vault.modify` is **not** atomic; the journal is what provides crash consistency.
- **DurableJson**: plugin state uses two alternating slots with sequence number + checksum, so a torn
  write loses at most the latest change and never the whole state (no reliance on atomic rename).

## Timer protocol

State machine `idle → running ⇄ paused → stopping → idle`, plus `recovering`.

- Session = context + **segments** of wall-clock timestamps; elapsed = Σ(end − start). No counters.
- Heartbeat every 15 s persists liveness and compares wall-clock delta vs `performance.now()` delta:
  - wall < mono − 30 s → clock moved back: segment is closed at the monotonic end, new segment starts.
  - wall > mono + 30 s → suspend or forward jump: segment closed at the last awake instant → `recovering`.
- On load, a running session whose heartbeat is older than _staleAfter_ (default 2 min) → `recovering`;
  the open segment is closed at the last heartbeat. The user decides about the gap.
- **Commit** (stop): (1) persist session as `stopping` with the final entry payload, (2) `createIfAbsent`
  the entry – its ID is derived from the session ID and its path is deterministic, (3) clear session and
  append to the committed log. A crash between any step resumes on load without duplicates.
- Repeated/concurrent `stop()` calls are serialized; the second returns `nothing_to_stop`.

## Billing

`computeBatch` (pure) turns approved entries + expenses + explicit fixed price/retainer selections into
lines; amounts from exact seconds × rate snapshot, rounded per entry per the configured rule, all in
integer cents. Day rates apply only to projects billed per day by contract. Fixed-price time is listed
at 0 €. `createBatch` re-checks eligibility inside the write lock (no double billing), writes the batch and
reserves entries in one journaled operation. CSV export never changes billing state; invoicing requires
an explicit confirmation with the external invoice number.

## UI

Svelte 5 components mounted in Obsidian `ItemView`s (main view + timer sidebar) and `Modal`s. Reactivity:
the index emits change events → plugin debounces into a `version` store → views recompute memoized
queries. Strings come from `shared/i18n`: dictionary keys via `t()` (German and complete English dictionary) and inline
`msg(de, en)` for messages; the language follows Obsidian unless set in the plugin settings. Styles use
Obsidian CSS variables with the LYTEX brand colours as accents; container queries collapse the navigation
in narrow panes.

## Integrations

`infrastructure/integrations/integrations.ts` defines the adapter contract (`AccountingAdapter`). Only the
local CSV export exists. Lexware Office and GitHub are **not implemented** (no undocumented endpoints, no
credential storage). Obsidian ≥ 1.11.4 offers `app.secretStorage` (Keychain); a future adapter should use
it.
