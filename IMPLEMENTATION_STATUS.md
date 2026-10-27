# Implementation status

_Last updated: 2026-10-27 · version 0.3.0_

## Phases

| #   | Phase                                                                                                            | Status     | Verification                                   |
| --- | ---------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------- |
| 1   | Foundation (scaffold, TS strict, Svelte, esbuild, Vitest, ESLint, Prettier, CI, settings, navigation, dashboard) | ✅         | check pipeline green; loads in Obsidian 1.14.4 |
| 2   | Data layer (schemas, IDs, repository, validation, index, migrations, journal, recovery)                          | ✅         | unit/integration tests incl. failure injection |
| 3   | CRM (customers, contacts, interactions, search, detail, timeline)                                                | ✅         | tests + UI test in Obsidian (customer form)    |
| 4   | Projects (CRUD wizard, billing models, budgets/alerts, milestones, analytics)                                    | ✅         | tests + UI (wizard)                            |
| 5   | Tickets (CRUD, Kanban, workflow, DoD, dependencies, checklists, subtasks, bulk, templates)                       | ✅         | tests + UI (Kanban DnD, DoD)                   |
| 6   | Time tracking (timer engine, persistence, recovery, manual, corrections, timesheet)                              | ✅         | 24 timer tests + real crash (SIGKILL) test     |
| 7   | Billing (rates, approval, batches, CSV, invoice refs, payments, quotes, expenses)                                | ✅         | tests + UI billing flow                        |
| 8   | Dashboards & analytics (time/finance/project, charts, filters, metric definitions)                               | ✅         | rendered with real data; component tests       |
| 9   | Recurring operations (recurrence engine, idempotent generation, missed reconciliation)                           | ✅         | tests incl. restart & lost watermark           |
| 10  | Integrations (interface, CSV adapter)                                                                            | ⚠️ partial | Lexware/GitHub intentionally not implemented   |
| 11  | Hardening (perf, security review, backup docs, UI polish, docs, packaging)                                       | ✅         | perf benchmark, docs                           |

## Known limitations / not implemented

- Documentation files other than README and the user guides are in English only.

- **Lexware Office / OpenAI / DeepL / GitHub integrations**: not implemented (adapter interface only).
  API keys can already be stored in Obsidian's Keychain (Einstellungen), but nothing uses them yet.
- **English UI** only partial (falls back to German); domain error messages are German.
- **Archive** sets a flag (and hides records); notes are not moved to `99 Archive/` automatically.
- **Ticket templates** are built-in presets; user-defined templates from `06 Templates/` are not read.
- **Undo**: no generic undo. Archive is reversible; Obsidian _File recovery_ + journal cover crashes.
- **Payments** are tracked per billing batch (no partial payments history).
- **Large tables** are not virtualised (filters keep lists manageable).
- **Multi-device**: timer state lives in `.obsidian/plugins/…/state` and syncs with the vault – do not run
  timers on two devices at once. Sync conflict copies of notes are detected as duplicate IDs.
- „Plugin-Einstellungen öffnen“ uses Obsidian's undocumented `app.setting` (guarded; falls back to a notice).
- Deleting is not journaled across files: an interruption can leave an orphaned child record (reported by Datenprüfung).
- Not verified on real hardware: suspend detection via `performance.now()`, DST night with running timer,
  light theme, Dataview/Bases interplay (see TEST_PLAN.md manual checklist).

## Known bugs

None open. Fixed during Obsidian integration testing: stale billing selection, invoice/payment dialogs not
closing, radio group inside label, breadcrumb, chart legend.

## Test status

`npm run check`: typecheck 0 errors, lint clean, 107 tests passed, build OK. Perf: see TEST_PLAN.md.

## Next steps

1. Lexware Office adapter using `app.secretStorage` once API documentation/credentials are available.
2. Move archived records to `99 Archive/` (with link updates via `fileManager.renameFile`).
3. User-defined ticket templates from `06 Templates/`.
4. Full English translation; translate domain error messages via codes.
5. Manual checklist items in TEST_PLAN.md.
