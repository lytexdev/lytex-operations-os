# LYTEX Operations OS

**Local-first business operations for freelancers and small IT service businesses – inside Obsidian.**

CRM, projects, tickets with Kanban, crash-safe time tracking, billing preparation, quotes, expenses,
recurring maintenance work, dashboards and analytics. Every record is a plain Markdown note with YAML
frontmatter in your vault: readable, searchable and versionable even without the plugin.
No cloud, no backend, no telemetry.

> 🇩🇪 Deutsch: siehe [unten](#deutsch).

## Features

- **CRM** – customers, contacts, interaction history, duplicate warnings, references to your password
  manager (never passwords).
- **Projects** – time & materials, fixed price, retainer or internal; contractual budgets vs. internal
  estimates, budget alerts, milestones, profitability.
- **Tickets** – configurable workflow, list and Kanban (drag & drop incl. manual ordering, keyboard),
  multiple assignees, checklists, dependencies, subtickets, Markdown descriptions with images,
  comments, templates, bulk actions, optional Definition-of-Done rules.
- **Time tracking you can bill from** – elapsed time is derived from stored timestamps, never counted;
  survives reloads, crashes, reboots and sleep; offline time is never added without asking; one timer
  session can never create two entries.
- **Billing preparation** – approval workflow, billing batches, CSV export for your accounting tool,
  explicit invoice confirmation, payments, adjustments for invoiced time. Money is always integer cents.
- **Quotes, expenses, recurring tasks** (missed dates are caught up, never duplicated).
- **Dashboard & analytics** with clearly defined metrics (tracked ≠ billable ≠ invoiced ≠ paid).
- **Data integrity** – schema validation, write-ahead journal for crash recovery, corrupt-file and
  duplicate-ID detection, referential checks, schema migrations.
- **German and English UI** (follows Obsidian's language), configurable accent colour.
- **API keys** for future integrations are stored in Obsidian's encrypted keychain, never in notes.

## Installation

The plugin is not (yet) in the Obsidian community catalogue. Install it manually:

1. Download `main.js`, `manifest.json` and `styles.css` from the latest
   [release](../../releases).
2. Copy them to `<your vault>/.obsidian/plugins/lytex-operations-os/`.
3. In Obsidian: _Settings → Community plugins_ → enable **LYTEX Operations OS**.

Requires Obsidian Desktop ≥ 1.11.4. On first start the plugin creates its folder (`LYTEX OS/`, configurable)
and asks for your name – nothing outside that folder is ever touched.

Build from source: see [DEVELOPMENT.md](DEVELOPMENT.md). Want to try it with sample data first?
`npm run example-vault` creates a vault with fictional data in `.example-vault/`.

## Documentation

| Document                                                              | Content                                      |
| --------------------------------------------------------------------- | -------------------------------------------- |
| [USER_GUIDE.md](USER_GUIDE.md) / [USER_GUIDE.de.md](USER_GUIDE.de.md) | Daily usage                                  |
| [INSTALLATION.md](INSTALLATION.md)                                    | Install, update, uninstall                   |
| [ARCHITECTURE.md](ARCHITECTURE.md)                                    | Layers, persistence, timer protocol          |
| [DATA_MODEL.md](DATA_MODEL.md)                                        | Entities, fields, states, metric definitions |
| [DEVELOPMENT.md](DEVELOPMENT.md)                                      | Dev setup, scripts, conventions              |
| [TEST_PLAN.md](TEST_PLAN.md)                                          | Automated and manual tests, performance      |
| [SECURITY.md](SECURITY.md)                                            | Privacy, secrets, reporting vulnerabilities  |
| [BACKUP_RECOVERY.md](BACKUP_RECOVERY.md)                              | Backups and recovery procedures              |
| [CONTRIBUTING.md](CONTRIBUTING.md)                                    | How to contribute                            |
| [CHANGELOG.md](CHANGELOG.md)                                          | Release notes                                |

## Status

Version 0.3.0 – used in production by its author. Integrations (Lexware Office, OpenAI, DeepL) are
prepared but **not implemented yet**; CSV export is the accounting interface. Mobile is not supported.
See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for known limitations.

## License

[MIT](LICENSE) © LYTEX

---

## Deutsch

**LYTEX Operations OS** ist ein lokales Business-System für Freelancer und kleine IT-Dienstleister direkt
in Obsidian: CRM, Projekte, Tickets mit Kanban, absturzsichere Zeiterfassung, Abrechnungsvorbereitung,
Angebote, Ausgaben, wiederkehrende Wartungsaufgaben und Auswertungen. Alle Daten sind normale
Markdown-Notizen in deinem Vault – ohne Cloud, ohne Server, ohne Telemetrie.

Installation: `main.js`, `manifest.json` und `styles.css` aus dem neuesten Release nach
`<Vault>/.obsidian/plugins/lytex-operations-os/` kopieren und unter _Einstellungen → Community-Plugins_
aktivieren. Die Oberfläche folgt automatisch der Obsidian-Sprache (Deutsch/Englisch).
Bedienungsanleitung: [USER_GUIDE.de.md](USER_GUIDE.de.md).
