import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      obsidian: fileURLToPath(new URL('./tests/helpers/obsidian-stub.ts', import.meta.url)),
    },
    conditions: ['browser'],
  },
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: process.env['LYTEX_PERF'] ? ['node_modules/**'] : ['tests/perf/**', 'node_modules/**'],
    environment: 'node',
    testTimeout: 20000,
  },
});
