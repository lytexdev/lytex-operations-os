<script lang="ts">
  import { msg } from '@/shared/i18n';
  import { dep } from '../components/labels';
  import type { UiApi } from '../stores/ui-api';
  import { t } from '@/shared/i18n';
  import { exportBatchCsv, cancelBatch } from '@/application/use-cases/billing';
  import { describeRounding } from '@/domain/services/rounding';
  import { money, date, dateTime } from '../components/labels';
  import Section from '../components/Section.svelte';
  import Stat from '../components/Stat.svelte';
  import StatusBadge from '../components/StatusBadge.svelte';
  import Empty from '../components/Empty.svelte';

  let { api, id }: { api: UiApi; id: string } = $props();
  const version = api.version;
  const b = $derived(dep($version, () => api.ctx.index.get('billing_batch', id)));
  const customer = $derived(b ? api.ctx.index.get('customer', b.customer_id) : undefined);

  async function cancel() {
    const reason = msg('Storniert durch Nutzer', 'Cancelled by user');
    if (await api.confirm(t('billing.cancelBatch'), t('billing.cancelConfirm')))
      await api.run(() => cancelBatch(api.ctx, id, reason), t('common.saved'));
  }
</script>

{#if !b}
  <Empty text={msg('Abrechnungslauf nicht gefunden.', 'Billing batch not found.')} />
{:else}
  <div class="lx-page">
    <div class="lx-detail-head">
      <div>
        <h2>{b.batch_number} <StatusBadge prefix="batch.status" value={b.status} /></h2>
        <div class="lx-muted">
          {customer?.name ?? '—'} · {date(b.period_from)} – {date(b.period_to)} · {describeRounding(
            b.rounding,
          )}
        </div>
      </div>
      <div class="lx-actions">
        <button type="button" onclick={() => api.openNote(b.id)}>{t('common.openNote')}</button>
        {#if b.status !== 'cancelled'}<button
            type="button"
            onclick={() =>
              api.run(() => exportBatchCsv(api.ctx, id), msg('CSV exportiert', 'CSV exported'))}
            >{t('billing.exportCsv')}</button
          >{/if}
        {#if b.status === 'draft' || b.status === 'exported'}
          <button type="button" onclick={cancel}>{t('billing.cancelBatch')}</button>
          <button
            type="button"
            class="mod-cta"
            onclick={() => api.openForm({ kind: 'invoice', id: b.id })}
            >{t('billing.confirmInvoice')}</button
          >
        {/if}
        {#if b.status === 'invoiced'}<button
            type="button"
            class="mod-cta"
            onclick={() => api.openForm({ kind: 'payment', id: b.id })}
            >{t('billing.recordPayment')}</button
          >{/if}
      </div>
    </div>
    {#if b.status === 'draft' || b.status === 'exported'}<p class="lx-callout">
        {t('billing.exportNote')}
      </p>{/if}
    <div class="lx-stats">
      <Stat label={t('billing.net')} value={money(b.net_cents, b.currency)} tone="brand" />
      <Stat
        label={t('billing.invoiceRef')}
        value={b.invoice_ref || '—'}
        hint={b.invoice_date ? date(b.invoice_date) : ''}
      />
      <Stat
        label={t('billing.paidAmount')}
        value={b.paid_cents != null ? money(b.paid_cents) : '—'}
        hint={b.paid_at ? date(b.paid_at) : ''}
      />
    </div>
    <Section title={t('billing.lines')}>
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
          {#each b.lines as l, i (i)}
            <tr
              ><td>{l.description}</td><td class="lx-num"
                >{(l.quantity_milli / 1000).toLocaleString('de-DE', {
                  maximumFractionDigits: 3,
                })}</td
              ><td>{l.unit}</td><td class="lx-num">{money(l.unit_price_cents)}</td><td
                class="lx-num">{money(l.total_cents)}</td
              ></tr
            >
          {/each}
          <tr class="lx-total"
            ><td colspan="4">{t('billing.net')}</td><td class="lx-num">{money(b.net_cents)}</td></tr
          >
        </tbody>
      </table>
    </Section>
    <div class="lx-grid-2">
      <Section title={t('billing.exports')}>
        <ul class="lx-list">
          {#each b.exports as x, i (i)}<li>
              <button type="button" class="lx-link" onclick={() => api.openNote(x.path)}
                >{x.path.split('/').pop()}</button
              ><span class="lx-muted">{dateTime(x.at)} · {x.rows} {msg('Zeilen', 'rows')}</span>
            </li>{:else}<li class="lx-muted">—</li>{/each}
        </ul>
      </Section>
      <Section title={t('time.history')}>
        <ul class="lx-list lx-timeline">
          {#each [...b.history].reverse() as h, i (i)}<li>
              <span>{h.action}{h.detail ? `: ${h.detail}` : ''}</span><span class="lx-muted"
                >{dateTime(h.at)}</span
              >
            </li>{/each}
        </ul>
      </Section>
    </div>
  </div>
{/if}
