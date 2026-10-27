<script lang="ts">
  import { msg } from '@/shared/i18n';
  import { dep } from '../components/labels';
  import type { UiApi } from '../stores/ui-api';
  import { t } from '@/shared/i18n';
  import { money } from '../components/labels';
  import Empty from '../components/Empty.svelte';

  let { api }: { api: UiApi } = $props();
  const version = api.version;
  const services = $derived(
    dep($version, () =>
      api.ctx.index
        .all('service')
        .filter((s) => !s.archived)
        .sort((a, b) => a.name.localeCompare(b.name)),
    ),
  );
  const s = $derived(dep($version, () => api.settings()));
</script>

<div class="lx-page">
  <div class="lx-toolbar">
    <h2>{t('nav.services')}</h2>
    <span class="lx-spacer"></span>
    <button type="button" class="mod-cta" onclick={() => api.openForm({ kind: 'service' })}
      >{t('service.new')}</button
    >
  </div>
  <p class="lx-muted lx-small">
    {msg(
      'Satz-Rangfolge: 1. Projekt/Vertrag → 2. Kunde → 3. Leistung → 4. Standard',
      'Rate precedence: 1. project/contract → 2. customer → 3. service → 4. default',
    )} ({money(s.defaultHourlyRateCents)}). {msg(
      'Der angewandte Satz wird in jedem Zeiteintrag gespeichert; spätere Änderungen wirken nicht rückwirkend.',
      'The applied rate is stored in every time entry; later changes are not retroactive.',
    )}
  </p>
  {#if services.length === 0}
    <Empty text={msg('Keine Leistungen angelegt.', 'No services yet.')} />
  {:else}
    <table class="lx-table">
      <thead
        ><tr
          ><th>{t('service.name')}</th><th class="lx-num">{t('service.rate')}</th><th
            >{t('ticket.billable')}</th
          ><th>{t('common.description')}</th><th></th></tr
        ></thead
      >
      <tbody>
        {#each services as sv (sv.id)}
          <tr>
            <td
              ><button
                type="button"
                class="lx-link"
                onclick={() => api.openForm({ kind: 'service', id: sv.id })}>{sv.name}</button
              ></td
            >
            <td class="lx-num">{money(sv.rate_cents)}</td>
            <td>{sv.billable ? t('common.yes') : t('common.no')}</td>
            <td class="lx-muted">{sv.description}</td>
            <td class="lx-row-actions"
              ><button
                type="button"
                class="lx-icon-btn"
                aria-label={t('common.archive')}
                onclick={() => api.run(() => api.ctx.repo.archive('service', sv.id))}>🗄</button
              ></td
            >
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>
