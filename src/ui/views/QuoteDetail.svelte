<script lang="ts">
  import { msg } from '@/shared/i18n';
  import { confirmDelete } from '../components/delete';
  import { dep } from '../components/labels';
  import type { UiApi } from '../stores/ui-api';
  import { t } from '@/shared/i18n';
  import { quoteTotals, setQuoteStatus, exportQuoteCsv } from '@/application/use-cases/finance';
  import { allowedQuoteTransitions } from '@/domain/policies/billing-status';
  import { money, date, dateTime, label } from '../components/labels';
  import Section from '../components/Section.svelte';
  import StatusBadge from '../components/StatusBadge.svelte';
  import Empty from '../components/Empty.svelte';

  let { api, id }: { api: UiApi; id: string } = $props();
  const version = api.version;
  const q = $derived(dep($version, () => api.ctx.index.get('quote', id)));
  const totals = $derived(q ? quoteTotals(q) : null);
</script>

{#if !q || !totals}
  <Empty text={msg('Angebot nicht gefunden.', 'Quote not found.')} />
{:else}
  <div class="lx-page">
    <div class="lx-detail-head">
      <div>
        <h2>{q.quote_number} {q.title} <StatusBadge prefix="quote.status" value={q.status} /></h2>
        <div class="lx-muted">
          <button
            type="button"
            class="lx-link"
            onclick={() => api.router.go({ name: 'customer', id: q.customer_id })}
            >{api.ctx.index.get('customer', q.customer_id)?.name}</button
          >
          · {date(q.issue_date)} · {t('quote.validUntil')}
          {date(q.valid_until)}
        </div>
      </div>
      <div class="lx-actions">
        {#if q.status === 'draft'}<button
            type="button"
            onclick={() => api.openForm({ kind: 'quote', id: q.id })}>{t('common.edit')}</button
          >{/if}
        <button type="button" onclick={() => api.openNote(q.id)}>{t('common.openNote')}</button>
        <button
          type="button"
          class="mod-warning"
          onclick={async () => {
            if (await confirmDelete(api, 'quote', q.id, `${q.quote_number} ${q.title}`))
              api.router.go({ name: 'quotes' });
          }}>{t('common.delete')}</button
        >
        <button
          type="button"
          onclick={() =>
            api.run(() => exportQuoteCsv(api.ctx, q.id), msg('CSV exportiert', 'CSV exported'))}
          >{t('common.export')} (CSV)</button
        >
        {#each allowedQuoteTransitions(q.status) as s (s)}
          <button
            type="button"
            class:mod-cta={s === 'sent' || s === 'accepted'}
            onclick={() => api.run(() => setQuoteStatus(api.ctx, q.id, s), t('common.saved'))}
            >→ {label('quote.status', s)}</button
          >
        {/each}
        {#if q.status === 'accepted' && !q.project_id}
          <button
            type="button"
            onclick={() =>
              api.openForm({
                kind: 'project',
                preset: {
                  customer_id: q.customer_id,
                  name: q.title,
                  budget_cents: totals.netCents,
                },
              })}>{t('project.new')}</button
          >
        {/if}
      </div>
    </div>
    <p class="lx-callout">{t('quote.note')}</p>
    <Section title={t('quote.lines')}>
      <table class="lx-table lx-table-compact">
        <thead
          ><tr
            ><th>{t('common.description')}</th><th class="lx-num">{t('quote.qty')}</th><th
              >{t('quote.unit')}</th
            ><th class="lx-num">{t('quote.unitPrice')}</th><th class="lx-num"
              >{t('common.total')}</th
            ></tr
          ></thead
        >
        <tbody>
          {#each q.lines as l, i (i)}
            <tr
              ><td>{l.description}</td><td class="lx-num"
                >{(l.quantity_milli / 1000).toLocaleString('de-DE', {
                  maximumFractionDigits: 3,
                })}</td
              ><td>{l.unit}</td><td class="lx-num">{money(l.unit_price_cents)}</td><td
                class="lx-num">{money(totals.lines[i]!.total_cents)}</td
              ></tr
            >
          {/each}
          {#if totals.discountCents}<tr
              ><td colspan="4">{t('quote.discount')} {q.discount_bp / 100} %</td><td class="lx-num"
                >-{money(totals.discountCents)}</td
              ></tr
            >{/if}
          <tr class="lx-total"
            ><td colspan="4">{t('billing.net')}</td><td class="lx-num"
              >{money(totals.netCents, q.currency)}</td
            ></tr
          >
        </tbody>
      </table>
    </Section>
    <Section title={t('time.history')}>
      <ul class="lx-list lx-timeline">
        {#each [...q.history].reverse() as h, i (i)}<li>
            <span>{h.action}{h.detail ? `: ${h.detail}` : ''}</span><span class="lx-muted"
              >{dateTime(h.at)}</span
            >
          </li>{/each}
      </ul>
    </Section>
  </div>
{/if}
