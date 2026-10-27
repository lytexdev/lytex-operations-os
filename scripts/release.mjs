// Package the plugin: node scripts/release.mjs → release/<version>/{main.js,manifest.json,styles.css}
import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
if (pkg.version !== version) {
  console.error(`Version mismatch: package.json ${pkg.version} vs manifest.json ${version}`);
  process.exit(1);
}
execSync('npm run check', { cwd: root, stdio: 'inherit' });
const out = path.join(root, 'release', version);
mkdirSync(out, { recursive: true });
for (const f of ['main.js', 'manifest.json', 'styles.css'])
  copyFileSync(path.join(root, f), path.join(out, f));
console.warn(`Release ${version} → ${out}`);
