import esbuild from 'esbuild';
import sveltePlugin from 'esbuild-svelte';
import builtins from 'builtin-modules';
import process from 'node:process';
import svelteConfig from './svelte.config.js';

const prod = process.argv[2] === 'production';

const banner = `/*
LYTEX Operations OS – generated bundle. Source: see repository (src/).
*/`;

const context = await esbuild.context({
  banner: { js: banner },
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: [
    'obsidian',
    'electron',
    '@codemirror/autocomplete',
    '@codemirror/collab',
    '@codemirror/commands',
    '@codemirror/language',
    '@codemirror/lint',
    '@codemirror/search',
    '@codemirror/state',
    '@codemirror/view',
    '@lezer/common',
    '@lezer/highlight',
    '@lezer/lr',
    ...builtins,
  ],
  alias: { '@': './src' },
  plugins: [
    sveltePlugin({
      compilerOptions: { ...svelteConfig.compilerOptions, css: 'injected', dev: !prod },
    }),
  ],
  conditions: ['svelte', 'browser'],
  mainFields: ['svelte', 'browser', 'module', 'main'],
  format: 'cjs',
  target: 'es2022',
  logLevel: 'info',
  sourcemap: prod ? false : 'inline',
  treeShaking: true,
  minify: prod,
  outfile: 'main.js',
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
