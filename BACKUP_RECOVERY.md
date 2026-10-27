# Backup & recovery

## What to back up

- The vault folder, at minimum `LYTEX OS/` (all business data) and
  `.obsidian/plugins/lytex-operations-os/` (`data.json` settings, `state/` = running timer + write journal).
- Exports in `LYTEX OS/04 Finance/Exports/` are reproducible but document what was sent to accounting.

## Recommended setup

1. Full-disk encryption on every device.
2. Versioned, encrypted backup of the vault (e.g. restic/borg to an external disk or remote, daily),
   independent of any file sync (Obsidian Sync, Nextcloud, Dropbox …) (sync is not a backup – deletions sync too).
3. Optional: the vault git repository for history (commit regularly; remember git keeps deleted data).
4. Test a restore at least quarterly (checklist below).

## Restore

1. Quit Obsidian. Restore the vault folder (or only `LYTEX OS/` + plugin folder).
2. Start Obsidian. The plugin replays the journal, rebuilds the index and checks integrity.
3. Open **Datenprüfung**: resolve reported issues (duplicate IDs, broken references).
4. If a timer was running at backup time, the recovery dialog appears – usually choose “nicht zählen”.

## Recovery procedures

| Situation                                      | Procedure                                                                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Obsidian crashed while the timer ran           | On next start the recovery dialog appears; decide how to treat the gap.                                                                    |
| Crash during a save / multi-file operation     | Automatic: journal roll-forward on startup; notice shows how many writes were completed.                                                   |
| Journal conflict reported                      | The intended content is in `.obsidian/plugins/lytex-operations-os/state/conflicts/`. Compare with the note, merge manually.                |
| Note shows “Lesefehler”/“Ungültige Daten”      | Open the note (Datenprüfung → path), fix the frontmatter; the index updates on save. Obsidian’s _File recovery_ core plugin has snapshots. |
| Duplicate ID (copied note, sync conflict copy) | Keep the correct note, delete/rename the copy or give it a new `id`.                                                                       |
| Billing batch half applied (integrity error)   | Normally fixed by the journal. Otherwise cancel the batch (_Lauf stornieren_) and recreate it.                                             |
| Wrong batch                                    | Not yet invoiced → cancel. Invoiced → correct in accounting, then adjustments for entries.                                                 |
| Index looks stale                              | Command “Index neu aufbauen”. The index is derived; nothing is lost.                                                                       |
| Timer state file corrupt                       | Two-slot state falls back to the previous slot; worst case delete `state/timer.*.json` (running session lost, entries unaffected).         |

## Restore test checklist

- [ ] Restore to a temporary folder, open as vault, deploy plugin.
- [ ] Dashboard numbers match the original.
- [ ] Datenprüfung shows no errors.
- [ ] A billing batch CSV can be re-exported.
