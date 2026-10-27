/** Shared Svelte compiler settings (used by svelte-check, vitest and esbuild). */
export default {
  compilerOptions: {
    // UI components receive a stable `api` object that never changes after mount,
    // so capturing it at initialisation is intended.
    warningFilter: (w) => w.code !== 'state_referenced_locally',
  },
};
