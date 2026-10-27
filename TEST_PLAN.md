# Test plan

## Automated (Vitest) – `npm test`

| Suite         | File                                            | Covers                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Domain        | `tests/domain/domain.test.ts`                   | money rounding & parsing, durations, DST calendar math, ULIDs, rounding rules, recurrence (weekly/bi-weekly/monthly clamp/n-days/end date/idempotent planning), workflow & DoD, cycles, billing state machine, rate precedence, budgets, fixed-price profitability, duplicates, CSV escaping/formula guard, schema invariants                                                              |
| Use cases     | `tests/domain/use-cases.test.ts`                | project numbering/keys/billing rules/subfolders, ticket numbering, activity, DoD enforcement, dependencies & cycles, bulk actions, primary contact, recurring generation incl. lost `generated_through` and restart                                                                                                                                                                        |
| Persistence   | `tests/persistence/persistence.test.ts`         | frontmatter round-trip, YAML errors, CRUD/archive, body & unknown-key preservation, optimistic conflicts, external modification, validation, root isolation, corrupt files, duplicate IDs, broken refs, truncated write → journal roll-forward, external change after crash → conflict copy, index rebuild, migrations & write-back, durable two-slot JSON                                 |
| Timer         | `tests/timer/timer.test.ts`                     | start/stop, timestamp-derived elapsed, pause/resume segments, single active timer, concurrent & repeated stop, too-short sessions, discard, context changes, reload, crash → recovery (exclude/include/end-at/discard), paused across reboot, crash between commit steps (both orders), torn state write, suspend detection, wall clock moved back, >24 h sessions, UTC storage, DST night |
| Billing       | `tests/billing/billing.test.ts`                 | rate snapshots, internal projects, overlaps (warn/block), edit history & locking, per-entry rounding, eligibility & double billing (incl. concurrent), batch → CSV (no status change) → invoice → payment, cancel, interrupted batch creation recovered by journal, fixed price, retainer overage, daily rate, discount + expenses, adjustments, duplicate invoice numbers, quote totals   |
| UI logic      | `tests/ui/logic.test.ts`                        | router/back history, form field validation, ticket filter presets, search ranking/archived                                                                                                                                                                                                                                                                                                 |
| UI components | `tests/ui/components.test.ts` (jsdom)           | empty states, progress clamping/ARIA, dashboard empty vs data, customer list filtering, timer panel controls (project required, start/pause/resume/stop → one entry), discard confirmation                                                                                                                                                                                                 |
| Performance   | `tests/perf/perf.test.ts` (`npm run test:perf`) | 100 customers, 500 projects, 5 000 tickets, 50 000 time entries                                                                                                                                                                                                                                                                                                                            |

Latest run: **107 tests passed** (+1 perf test), `typecheck` 0 errors, `lint` clean, build OK.

### Performance results (Linux laptop, Node 22)

| Measurement                                            | Target   | Result    |
| ------------------------------------------------------ | -------- | --------- |
| Index build, parsing YAML (fallback path)              | < 15 s   | 11.7 s    |
| Index build from Obsidian metadata cache (plugin path) | < 3 s    | **0.5 s** |
| Dashboard aggregates, cold (all projects' totals)      | < 1.5 s  | 0.34 s    |
| Dashboard aggregates, cached (same index version)      | < 50 ms  | 19 ms     |
| Cross-entity search                                    | < 300 ms | 116 ms    |
| Ticket filter (overdue + text)                         | < 300 ms | 4 ms      |
| Single file re-index                                   | < 50 ms  | < 1 ms    |
| Referential integrity check                            | –        | 0.24 s    |

Not measured: rendering of very large tables in Obsidian (tables are not virtualised; filter first).

## Integration test in real Obsidian (performed 2026-10-23, Obsidian 1.14.4, Linux/Wayland)

Isolated profile + test vault, driven via Chrome DevTools Protocol:
`electron /usr/lib/obsidian/app.asar --user-data-dir=<tmp> --remote-debugging-port=9333`.

Verified:

- Plugin loads without console errors; 47 example entities indexed, no data issues.
- Dashboard renders real data; narrow pane collapses navigation.
- Ticket detail “Timer starten” → status bar + timer chip; plugin reload while running keeps the session;
  pause/resume via commands; stop from sidebar with short-entry confirmation → exactly one entry note
  with two segments.
- **SIGKILL of Obsidian while the timer ran**, restart after ~3 min → recovery dialog shown, offline time
  not counted (20 s recorded), “nicht zählen, stoppen” → one `recovery` entry.
- Customer form: duplicate warning, e-mail validation, creation + navigation.
- Project wizard (3 steps), fixed-price validation; ticket from template (checklist, estimate).
- Kanban drag & drop (status change + activity), Definition of Done blocking with confirm/cancel.
- Billing UI: approve → expenses/fixed price → preview → batch → CSV export (status stays reserved) →
  invoice confirmation (validation, invoiced lock).

Bugs found and fixed through this test: stale approved selection in billing view, invoice/payment
dialogs not closing, radio group inside a `<label>`, breadcrumb label, chart legend.

## Manual checklist (not automated)

- [ ] Real system suspend/hibernate with running timer (suspend detection is unit-tested with a fake
      monotonic clock; Chromium's `performance.now()` behaviour across suspend was not verified on hardware).
- [ ] Real DST transition night with a running timer (logic is UTC-based and unit-tested).
- [ ] Light theme and other community themes (tested: default dark theme).
- [ ] Obsidian Sync/Nextcloud with two devices editing the same note (conflict copies are detected as
      duplicate IDs; not tested end-to-end).
- [ ] Dataview/Bases queries over the frontmatter (plain YAML, expected to work, not tested).
- [ ] Mobile: not supported (`isDesktopOnly`).
