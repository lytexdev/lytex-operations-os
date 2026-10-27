// Build the plugin and commit the release files to the `dist` branch, so an installed plugin folder
// that is a clone of this branch can be updated with `git pull`.
//   node scripts/publish-dist.mjs [--skip-build] [--push]
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
const FILES = ['main.js', 'manifest.json', 'styles.css'];

if (!args.has('--skip-build'))
  execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
for (const f of FILES)
  if (!existsSync(path.join(root, f))) throw new Error(`${f} missing – build first`);

const { version } = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const source = git(root, 'rev-parse', '--short', 'HEAD');
const dir = mkdtempSync(path.join(tmpdir(), 'lytex-dist-'));
const hasDist = git(root, 'branch', '--list', 'dist') !== '';
try {
  if (hasDist) git(root, 'worktree', 'add', dir, 'dist');
  else {
    git(root, 'worktree', 'add', '--detach', dir);
    git(dir, 'checkout', '--orphan', 'dist');
    git(dir, 'rm', '-rf', '--quiet', '.');
  }
  for (const f of FILES) copyFileSync(path.join(root, f), path.join(dir, f));
  // Local files of an installed plugin must never be committed or overwritten.
  writeFileSync(path.join(dir, '.gitignore'), 'data.json\nstate/\n.hotreload\n');
  writeFileSync(
    path.join(dir, 'README.md'),
    `# LYTEX Operations OS – release files\n\nThis branch contains only the built plugin (version ${version}).\n` +
      `Clone it into \`<vault>/.obsidian/plugins/lytex-operations-os\` and update with \`git pull\`.\n` +
      `Source code: branch \`main\`.\n`,
  );
  git(dir, 'add', '-A');
  if (git(dir, 'status', '--porcelain') === '') {
    console.warn(`dist already up to date (${version})`);
  } else {
    git(dir, 'commit', '-q', '-m', `dist: ${version} (source ${source})`);
    console.warn(`dist: committed ${version} (source ${source})`);
  }
  if (args.has('--push'))
    execFileSync('git', ['push', 'origin', 'dist'], { cwd: root, stdio: 'inherit' });
} finally {
  execFileSync('git', ['worktree', 'remove', '--force', dir], { cwd: root });
  rmSync(dir, { recursive: true, force: true });
}
