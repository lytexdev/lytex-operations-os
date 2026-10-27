# Contributing

Thanks for your interest! Issues and pull requests are welcome.

## Before you start

- For larger changes, open an issue first to discuss the idea.
- Never include real customer data, credentials or personal information in issues, tests,
  screenshots or example data. Use the fictional example vault (`npm run example-vault`).

## Development

```bash
npm install
npm run dev        # watch build into main.js
npm run check      # typecheck + lint + tests + production build – must pass
```

Read [ARCHITECTURE.md](ARCHITECTURE.md) and [DEVELOPMENT.md](DEVELOPMENT.md). Key rules:

- Domain and application code must not import `obsidian`.
- All writes go through the `Repository` (validated, journaled).
- Money in integer cents, durations in seconds, instants in UTC.
- UI texts via `t()` (dictionary keys in `src/shared/i18n/de.ts` and `en.ts`) or `msg(de, en)` for
  messages – every user-visible text needs a German and an English version.
- Schema changes need a version bump and a migration.
- Add tests for behaviour changes; timer and billing logic must stay fully covered.

## Pull requests

- Keep PRs focused; describe what changed and how you tested it (including manual tests in Obsidian
  for UI changes).
- Describe user-visible changes in the PR description (they become the release notes).
