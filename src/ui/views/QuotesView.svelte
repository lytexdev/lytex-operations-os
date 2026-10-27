<script lang="ts">
  import { dep } from '../components/labels';
  import type { UiApi } from '../stores/ui-api';
  import { t } from '@/shared/i18n';
  import { QUOTE_STATUSES } from '@/domain/schemas/entities';
  import { quoteTotals } from '@/application/use-cases/finance';
  import { money, date, label } from '../components/labels';
  import StatusBadge from '../components/StatusBadge.svelte';
  import Empty from '../components/Empty.svelte';

  let { api }: { api: UiApi } = $props();
  const version = api.version;
  let status = $state('');
  const quotes = $derived(
    dep($version, () =>
      api.ctx.index
        .all('quote')
        .filter((q) => !q.archived && (!status || q.status === status))
        .sort((a, b) => b.issue_date.localeCompare(a.issue_date)),
    ),
  );
</script>

<div class="lx-page">
  <div class="lx-toolbar">
    <h2>{t('nav.quotes')}</h2>
    <select bind:value={status} aria-label={t('common.status')}>
      <option value="">{t('common.all')}</option>
      {#each QUOTE_STATUSES as s (s)}<option value={s}>{label('quote.status', s)}</option>{/each}
    </select>
    <span class="lx-spacer"></span>
    <button type="button" class="mod-cta" onclick={() => api.openForm({ kind: 'quote' })}
      >{t('quote.new')}</button
    >
  </div>
  <p class="lx-muted lx-small">{t('quote.note')}</p>
  {#if quotes.length === 0}
    <Empty text={t('quote.empty')} />
  {:else}
    <table class="lx-table">
      <thead
        ><tr
          ><th>#</th><th>{t('quote.title')}</th><th>{t('project.customer')}</th><th
            >{t('quote.issueDate')}</th
          ><th>{t('quote.validUntil')}</th><th>{t('common.status')}</th><th class="lx-num"
            >{t('billing.net')}</th
          ></tr
        ></thead
      >
      <tbody>
        {#each quotes as q (q.id)}
          <tr class="lx-clickable" onclick={() => api.router.go({ name: 'quote', id: q.id })}>
            <td class="lx-mono">{q.quote_number}</td>
            <td
              ><button
                type="button"
                class="lx-link"
                onclick={(e) => {
                  e.stopPropagation();
                  api.router.go({ name: 'quote', id: q.id });
                }}>{q.title}</button
              ></td
            >
            <td>{api.ctx.index.get('customer', q.customer_id)?.name ?? '—'}</td>
            <td>{date(q.issue_date)}</td>
            <td>{date(q.valid_until)}</td>
            <td><StatusBadge prefix="quote.status" value={q.status} /></td>
            <td class="lx-num">{money(quoteTotals(q).netCents, q.currency)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>
