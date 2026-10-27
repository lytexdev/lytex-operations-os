// Read-only data check: node scripts/check-data.mjs <vaultPath>
import esbuild from 'esbuild';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const vault = path.resolve(process.argv[2] ?? '');
if (!process.argv[2] || !existsSync(path.join(vault, '.obsidian'))) {
  console.error('Usage: node scripts/check-data.mjs <vaultPath>');
  process.exit(1);
}
const settingsFile = path.join(vault, '.obsidian', 'plugins', 'lytex-operations-os', 'data.json');
const settings = existsSync(settingsFile) ? JSON.parse(readFileSync(settingsFile, 'utf8')) : {};
const tmp = mkdtempSync(path.join(tmpdir(), 'lytex-check-'));
const out = path.join(tmp, 'check.cjs');
await esbuild.build({
  entryPoints: [path.join(here, 'check-data.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: out,
  alias: { '@': path.join(here, '..', 'src') },
  logLevel: 'warning',
});
const { check } = createRequire(import.meta.url)(out);
const res = await check(vault, settings, path.join(tmp, 'state'));
rmSync(tmp, { recursive: true, force: true });
process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
process.exit(res.issues.some((i) => i.severity === 'error') ? 2 : 0);
