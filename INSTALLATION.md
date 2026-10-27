# Installation

Requirements: Obsidian Desktop ≥ 1.11.4 (tested with 1.14 on Linux). The plugin is desktop-only.
Node.js ≥ 20 is only needed to build from source.

## From a release (recommended)

1. Download `main.js`, `manifest.json` and `styles.css` from the latest GitHub release.
2. Create `<vault>/.obsidian/plugins/lytex-operations-os/` and copy the three files into it.
3. Obsidian → _Settings → Community plugins_ → enable **LYTEX Operations OS**.

## From source

```bash
git clone <repository-url> lytex-operations-os
cd lytex-operations-os
npm ci
npm run build
node scripts/deploy.mjs /path/to/your/vault   # copies main.js, manifest.json, styles.css
```

Tip: keep the source repository **outside** your vault (or in a folder starting with `.`), otherwise
Obsidian indexes `node_modules` and sync tools upload it.

## First start

The plugin creates its root folder (default `LYTEX OS/`, configurable under _Settings → LYTEX Operations
OS_) with the folder structure and a few overview notes, and asks for your name. Nothing outside the
root folder is ever created or modified.

## Update

Replace the three files (or run `npm run build` + `deploy.mjs`) and reload the plugin. Data never needs
to be migrated manually: schema migrations run automatically or via _Data health → Write migrations_.

## Uninstall

Disable and delete the plugin. All business data stay as Markdown notes in the root folder.
Plugin-internal state (running timer, write journal) lives in
`.obsidian/plugins/lytex-operations-os/state/` and can be deleted once no timer is running.
API keys are stored in Obsidian's keychain and can be removed under LYTEX OS → Settings.
