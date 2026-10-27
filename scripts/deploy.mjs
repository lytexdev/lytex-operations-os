// Copy the built plugin into a vault: node scripts/deploy.mjs <vaultPath>  (or OBSIDIAN_VAULT=...)
import { copyFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const vault = process.argv[2] ?? process.env.OBSIDIAN_VAULT;
if (!vault) {
  console.error('Usage: node scripts/deploy.mjs <vaultPath>');
  process.exit(1);
}
if (!existsSync(path.join(vault, '.obsidian'))) {
  console.error(`${vault} ist kein Obsidian-Vault (.obsidian fehlt).`);
  process.exit(1);
}
const { id } = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const target = path.join(vault, '.obsidian', 'plugins', id);
mkdirSync(target, { recursive: true });
for (const f of ['main.js', 'manifest.json', 'styles.css']) {
  if (!existsSync(path.join(root, f))) {
    console.error(`${f} fehlt – zuerst "npm run build" ausführen.`);
    process.exit(1);
  }
  copyFileSync(path.join(root, f), path.join(target, f));
}
console.warn(
  `Plugin nach ${target} kopiert. In Obsidian: Einstellungen → Community-Plugins → „LYTEX Operations OS“ aktivieren bzw. neu laden.`,
);
