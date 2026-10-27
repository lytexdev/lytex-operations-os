# Decisions (ADR log)

1. **Markdown + YAML frontmatter as the only store.** Human-readable, works without the plugin, syncs/
   versions with the vault. Consequence: no transactions → write-ahead journal (ADR 5).
2. **ULID-based IDs with type prefix** (`TKT-01J…`). Sortable, collision-free offline; filenames are cosmetic.
   Human numbers (K-0001, KEY-12, AB-2026-001) are derived from data (max + 1), not stored counters.
3. **Zod schemas as single source of truth**; unknown frontmatter keys are preserved so users and other
   plugins can add properties.
4. **Derived in-memory index** instead of a database. Rebuilt on startup from Obsidian's metadata cache
   (fast) with a YAML-parsing fallback; queries memoized per index version.
5. **Write-ahead journal with roll-forward** (not rollback): the intended full content of every affected
   file is logged before writing. Roll-forward is simpler and correct for idempotent "set state" writes;
   external edits after a crash are never overwritten (conflict copies instead).
6. **Timer state in plugin storage, not in a note**: avoids sync churn and note pollution; two-slot
   checksum format instead of relying on atomic rename (not guaranteed by Obsidian's adapter).
7. **Elapsed time from timestamps + heartbeat liveness**; offline gaps are never counted without explicit
   user confirmation (billing correctness over convenience). Entry ID derived from session ID → idempotent commit.
8. **Integer cents & integer thousandths for quantities**; rounding half-up away from zero; per-entry
   rounding documented on each batch.
9. **Rate snapshot on each entry**; precedence project → customer → service → default.
10. **CSV export ≠ invoiced.** Invoicing requires an explicit confirmation with the external invoice
    number. Accounting integrations only via documented APIs and secure secret storage (not implemented yet).
11. **Svelte 5 for views, Obsidian Modal/Setting/FuzzySuggest for native interactions.** Svelte compiled
    into the bundle; CSS uses Obsidian variables; brand colours only as accents.
12. **Source repository kept outside the vault** (or in a dot-folder Obsidian ignores), so `node_modules`
    is neither indexed by Obsidian nor uploaded by sync tools.
13. **Business data live in a configurable root folder (default `LYTEX OS/`) separate from the code** so customer data never ends
    up in the plugin repository.
14. **German UI default**, i18n dictionary with English fallback; domain error messages currently German.
15. **No personal defaults.** The team list starts empty; the first-run prompt asks for the user's name.
16. **Bilingual messages without a key explosion.** UI chrome uses dictionary keys (`t()`, English
    dictionary typed as a complete record), messages use inline `msg(de, en)` evaluated at call time.
    The language follows Obsidian (`moment.locale()`) unless set explicitly.
