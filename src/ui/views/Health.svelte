<script lang="ts">
  import { msg } from '@/shared/i18n';
  import { dep } from '../components/labels';
  import type { UiApi } from '../stores/ui-api';
  import { t } from '@/shared/i18n';
  import Section from '../components/Section.svelte';

  let { api }: { api: UiApi } = $props();
  const version = api.version;
  let rebuilding = $state(false);
  const issues = $derived(dep($version, () => api.ctx.index.issues()));
  const KIND: Record<string, string> = {
    parse: msg('Lesefehler', 'Read error'),
    schema: msg('Ungültige Daten', 'Invalid data'),
    duplicate_id: msg('Doppelte ID', 'Duplicate ID'),
    broken_ref: msg('Fehlende Referenz', 'Missing reference'),
    migration: msg('Schema-Version', 'Schema version'),
    mismatch: msg('Inkonsistenz', 'Inconsistency'),
  };

  async function rebuild() {
    rebuilding = true;
    const started = Date.now();
    await api.run(async () => {
      const n = await api.core.rebuildIndex();
      api.notify(`${n} Dateien in ${Date.now() - started} ms indexiert`, 'success');
    });
    rebuilding = false;
  }
</script>

<div class="lx-page">
  <div class="lx-toolbar">
    <h2>{t('health.title')}</h2>
    <span class="lx-muted"
      >{t('health.stats', { n: api.ctx.index.size, f: api.ctx.index.size })} · {t(
        'health.journal',
        { n: api.core.journal.pendingCount },
      )}</span
    >
    <span class="lx-spacer"></span>
    <button type="button" disabled={rebuilding} onclick={rebuild}>{t('health.rebuild')}</button>
    <button
      type="button"
      onclick={() =>
        api.run(async () =>
          api.notify(`${await api.ctx.repo.writeBackMigrations()} Dateien migriert`, 'success'),
        )}>{t('health.migrate')}</button
    >
  </div>
  <Section title={`${issues.length} Hinweise`}>
    {#if issues.length === 0}
      <p>{t('health.ok')}</p>
    {:else}
      <table class="lx-table lx-table-compact">
        <thead
          ><tr
            ><th>{msg('Art', 'Kind')}</th><th>{msg('Datei', 'File')}</th><th
              >{msg('Meldung', 'Message')}</th
            ></tr
          ></thead
        >
        <tbody>
          {#each issues as i, n (n)}
            <tr class:lx-danger={i.severity === 'error'}>
              <td>{KIND[i.kind] ?? i.kind}</td>
              <td
                ><button type="button" class="lx-link" onclick={() => api.openNote(i.path)}
                  >{i.path}</button
                ></td
              >
              <td>{i.message}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </Section>
  <p class="lx-muted lx-small">
    {msg(
      'Fehlerhafte Dateien werden nie automatisch überschrieben. Öffne die Datei, korrigiere das Frontmatter und speichere – der Index aktualisiert sich automatisch. Konfliktkopien aus der Wiederherstellung liegen im Plugin-Ordner unter',
      'Faulty files are never overwritten automatically. Open the file, fix the frontmatter and save – the index updates automatically. Conflict copies from recovery are in the plugin folder under',
    )} <code>state/conflicts/</code>.
  </p>
</div>
