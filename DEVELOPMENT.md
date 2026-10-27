# Development

```bash
npm install
npm run dev          # esbuild watch → main.js (inline source maps)
npm run typecheck    # tsc --noEmit + svelte-check
npm run lint         # ESLint (typescript-eslint + eslint-plugin-svelte)
npm run test         # Vitest (unit, integration, UI component tests)
npm run test:perf    # benchmark with 55 600 entities
npm run build        # production bundle
npm run check        # all of the above except perf
npm run example-vault  # fictional dataset in .example-vault/
npm run check-data -- /path/to/vault   # read-only integrity check of a vault
node scripts/deploy.mjs <vault>   # copy build into a vault
```

Toolchain: TypeScript 6 (strict, `noUncheckedIndexedAccess`), Svelte 5 (runes), Zod 4, yaml 2,
esbuild 0.28 + esbuild-svelte, Vitest 5 (+ jsdom, @testing-library/svelte), ESLint 10, Prettier 3.
CI: `.github/workflows/ci.yml`.

## Conventions

- Domain and application code must not import `obsidian`. Only `src/main.ts`, `src/infrastructure/obsidian/`,
  `src/ui/views/item-views.ts`, `settings-tab.ts` and `src/ui/modals/` may.
- Every write goes through `Repository` (validation, journal, index update). Multi-file changes:
  `repo.exclusive(() => { planCreate/planUpdate…; repo.commit(label, writes) })`.
- Money only via `shared/money`; never floats for amounts. Time: store UTC instants, compute calendar
  ranges with `shared/date` helpers.
- UI strings via `t()`; add keys to `shared/i18n/de.ts` (en optional).
- Svelte: derived values that read the index must depend on `$version` (`dep($version, () => …)` or
  `$derived.by(() => { void $version; … })`).
- Tests: use `tests/helpers/fixtures.ts` (`makeEnv`, `restart`, `FakeClock`) – it runs the real core
  on in-memory stores with failure injection.

## Manual testing in Obsidian

Use a separate vault (e.g. the example vault). For automation, Obsidian can be started with
`--user-data-dir=<tmp profile> --remote-debugging-port=9333` and driven via the Chrome DevTools Protocol
(see TEST_PLAN.md).
