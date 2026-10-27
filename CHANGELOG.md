# Changelog

## 0.3.0 – 2026-10-27 (first public release)

- Open source under the MIT license.
- Complete English UI; German and English follow Obsidian's language automatically (overridable).
  Generated notes, CSV headers, validation and error messages are localized as well.
- No personal defaults: empty team, first-run prompt for the user's name; default root folder `LYTEX OS`.
- Fresh installs get categories and workflow labels in the UI language.
- Project rule validation returns field-specific errors (no message parsing in the UI).
- GitHub release workflow, issue templates, contribution guide.

## 0.2.0 – 2026-10-24

- Tickets: multiple assignees (`assignees`, schema v2) with a team list and free-text names; “My work” =
  all open tickets assigned to me. Automatic migration (comma separated `assignee` → list).
- Workflow ohne „Blockiert“ (Backlog, To Do, In Arbeit, Review, Erledigt, Abgebrochen); unveränderte
  Standard-Workflows werden automatisch migriert.
- Schätzungen wahlweise in Minuten oder Stunden (Tickets, Projekte, wiederkehrende Aufgaben).
- Projektkürzel mit Bindestrichen (z. B. `LTX-B` → Tickets `LTX-B-1`).
- Ticket-Beschreibung & Notizen mit Markdown (Vorschau, Obsidian-Rendering) und Bildern
  (Button, Einfügen, Drag & Drop → `<Projekt>/Attachments/`); Kommentare mit Markdown.
- Kanban: Reihenfolge innerhalb einer Spalte per Drag & Drop (und Alt+↑/↓); neue Tickets ans Ende.
- Priorität „Normal“ blau, „Niedrig“ grau.
- Löschen (Papierkorb) mit Bestätigung für Kunden, Projekte, Tickets, Angebote, Ausgaben, Zeiteinträge,
  Ansprechpartner, wiederkehrende Aufgaben, Leistungen; Abrechnungsdaten blockieren das Löschen.
- „Zurück“ stellt Filter, Ansicht und Projekt-Tab wieder her.
- Navigation: „Meine Arbeit“ ist ein Filter im Punkt „Tickets“ (direkt unter Dashboard).
- Neue Seite „Einstellungen“: Akzentfarbe, Team, API-Schlüssel (Lexware Office, OpenAI, DeepL) im
  Obsidian-Schlüsselbund. Mindestversion Obsidian 1.11.4.

## 0.1.3 – 2026-10-24

- Standard-Stammordner ist jetzt `LYTEX/OS` (System-Ordner getrennt von `LYTEX/Assets` und `LYTEX/.dev`).
- Neues Skript `scripts/check-data.mjs <vault>`: schreibgeschützte Datenprüfung außerhalb von Obsidian.

## 0.1.2 – 2026-10-23

- Fix: Projekte für „Intern (LYTEX)“ (ohne Kunde) konnten nicht angelegt werden. Ohne Kunde wird das
  Abrechnungsmodell jetzt automatisch „Intern / nicht abrechenbar“; andere Modelle sind deaktiviert.

## 0.1.1 – 2026-10-23

- Default root folder is now `LYTEX` (data live directly in the `LYTEX` folder; code in hidden `LYTEX/.dev/`).
- Fix: root folder is applied with an explicit „Übernehmen“ button instead of on every keystroke.
- Fix: changing the root folder now creates the full folder structure and rebuilds the index
  (previously the change was not detected).

## 0.1.0 – 2026-10-23

First release.

- CRM: customers (duplicate warnings, password-manager references), contacts, interactions, timeline, statistics.
- Projects: wizard, 4 billing models, contractual vs internal budgets, alerts (50/75/90/100 %), milestones,
  profitability, project folders (Tickets, Meetings, Documentation, Attachments).
- Tickets: configurable workflow, list & Kanban (drag & drop, keyboard), checklists, dependencies, subtasks,
  comments/activity, templates, bulk actions, Definition of Done rules.
- Time tracking: crash-safe timer (segments, heartbeat, suspend/clock detection, recovery dialog,
  idempotent commit), sidebar panel, status bar, commands, manual entries, overlap policy, edit history,
  adjustments for invoiced entries, timesheet + CSV.
- Billing: rate precedence & snapshots, rounding, approval, batches (journaled), CSV export, invoice
  confirmation, payments, cancellation; quotes; expenses + CSV.
- Recurring tasks with idempotent occurrence generation and missed-run reconciliation.
- Dashboard & analytics (time, finance, projects) with documented metric definitions.
- Data integrity: Zod schemas, write-ahead journal, durable plugin state, migrations, integrity checks.
- German UI, English partial.
