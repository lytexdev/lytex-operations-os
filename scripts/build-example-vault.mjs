// Builds a fictional example vault: node scripts/build-example-vault.mjs [targetDir]
import esbuild from 'esbuild';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(process.argv[2] ?? path.join(here, '..', '.example-vault'));
if (existsSync(target) && readdirSync(target).length && !process.argv.includes('--force')) {
  console.error(`${target} ist nicht leer. Mit --force überschreiben.`);
  process.exit(1);
}
if (process.argv.includes('--force'))
  rmSync(path.join(target, 'LYTEX OS'), { recursive: true, force: true });
const tmp = mkdtempSync(path.join(tmpdir(), 'lytex-example-'));
const out = path.join(tmp, 'example.cjs');
await esbuild.build({
  entryPoints: [path.join(here, 'example-data.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: out,
  alias: { '@': path.join(here, '..', 'src') },
  logLevel: 'warning',
});
const { generate } = createRequire(import.meta.url)(out);
// Plugin state (journal) goes to a temp dir so the example only contains Markdown notes.
const res = await generate(target, path.join(tmp, 'state'));
rmSync(tmp, { recursive: true, force: true });
console.warn(`Beispiel-Vault erstellt: ${target} (${res.entities} Datensätze)`);
