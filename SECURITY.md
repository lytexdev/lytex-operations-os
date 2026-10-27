# Security & privacy

## Principles

- No network access at all: the plugin contains no `fetch`/HTTP code, no telemetry, no remote logging.
- Data stay in the vault as Markdown. Nothing is executed from notes; UI renders text only
  (`{@html}` is forbidden by lint rule), so note contents cannot inject HTML/scripts into the plugin UI.
- The plugin only writes inside its root folder and its own plugin folder. Other notes are never modified.
- Deletion is avoided: archive flags instead of deleting; Obsidian's trash is used where files are removed.
- CSV exports guard against spreadsheet formula injection (cells starting with `= + - @` are prefixed).
- Logs: only counts and error messages go to the developer console; no customer data are logged deliberately.

## Secrets

- **Never store passwords or tokens in notes or frontmatter.** Customer notes have a
  `password_manager_ref` field for a _reference_ (e.g. “Bitwarden: Kunde / Hosting”); the form warns
  when something looks like a credential.
- Plugin settings (`data.json`) are plain text and synced with the vault → not suitable for secrets.
- API keys (Lexware Office, OpenAI, DeepL) are entered under LYTEX OS → Einstellungen and stored only in
  Obsidian's Keychain (`app.secretStorage`, Obsidian ≥ 1.11.4). They never appear in notes, `data.json`
  or git; the UI only shows the last four characters. The integrations themselves are **not implemented
  yet** – the keys are not used and no network code exists.

## Threats & mitigations

| Risk                                               | Mitigation                                                                                                                                                              |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lost/stolen laptop                                 | Use full-disk encryption (LUKS/FileVault/BitLocker). Vault is not encrypted by Obsidian.                                                                                |
| Sync provider access (Obsidian Sync, Nextcloud, …) | Use server-side + ideally end-to-end encryption; know that `.obsidian/` incl. plugin state is synced.                                                                   |
| Git history                                        | Deleting a customer note does not remove it from git history. Rewrite history (`git filter-repo`) if data must be erased. Do not push the vault repo to public remotes. |
| Corrupted/malicious frontmatter                    | Zod validation; invalid files are ignored and reported, never executed.                                                                                                 |
| Accidental bulk changes                            | Archive instead of delete; journal + Obsidian file recovery; backups (BACKUP_RECOVERY.md).                                                                              |
| GDPR                                               | Customer data are personal data; keep retention in mind, archive/delete according to your policy.                                                                       |

## Reporting

Please report security vulnerabilities privately via GitHub's _Report a vulnerability_ (Security tab of the
repository) instead of a public issue. Never include real customer data or credentials in reports.
