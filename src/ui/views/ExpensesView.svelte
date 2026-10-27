<script lang="ts">
  import { msg } from '@/shared/i18n';
  import { dep } from '../components/labels';
  import type { UiApi } from '../stores/ui-api';
  import { t } from '@/shared/i18n';
  import { EXPENSE_BILLING_STATUSES } from '@/domain/schemas/entities';
  import { setExpenseStatus, exportExpensesCsv } from '@/application/use-cases/finance';
  import { localDate, startOfMonth } from '@/shared/date/time';
  import { money, date, label } from '../components/labels';
  import StatusBadge from '../components/StatusBadge.svelte';
  import Empty from '../components/Empty.svelte';
  import Stat from '../components/Stat.svelte';

  let { api }: { api: UiApi } = $props();
  const version = api.version;
  let from = $state(startOfMonth(localDate(Date.now())).slice(0, 4) + '-01-01');
  let to = $state(localDate(Date.now()));
  let status = $state('');
  const list = $derived(
    dep($version, () =>
      api.ctx.index
        .all('expense')
        .filter(
          (x) =>
            !x.archived &&
            x.date >= from &&
            x.date <= to &&
            (!status || x.billing_status === status),
        )
        .sort((a, b) => b.date.localeCompare(a.date)),
    ),
  );
  const total = $derived(list.reduce((a, x) => a + x.amount_cents, 0));
</script>

<div class="lx-page">
  <div class="lx-toolbar">
    <h2>{t('nav.expenses')}</h2>
    <input type="date" bind:value={from} aria-label={t('common.from')} />
    <input type="date" bind:value={to} aria-label={t('common.to')} />
    <select bind:value={status} aria-label={t('common.status')}>
      <option value="">{t('common.all')}</option>
      {#each EXPENSE_BILLING_STATUSES as s (s)}<option value={s}
          >{label('billing.status', s)}</option
        >{/each}
    </select>
    <span class="lx-spacer"></span>
    <button
      type="button"
      onclick={() =>
        api.run(
          () => exportExpensesCsv(api.ctx, from, to),
          msg('Export erstellt', 'Export created'),
        )}>{t('expense.export')}</button
    >
    <button type="button" class="mod-cta" onclick={() => api.openForm({ kind: 'expense' })}
      >{t('expense.new')}</button
    >
  </div>
  <div class="lx-stats">
    <Stat
      label={t('common.total')}
      value={money(total)}
      hint={`${list.length} ${msg('Belege', 'receipts')}`}
    />
  </div>
  {#if list.length === 0}
    <Empty text={t('expense.empty')} />
  {:else}
    <table class="lx-table">
      <thead
        ><tr
          ><th>{t('time.date')}</th><th>{t('expense.vendor')}</th><th>{t('common.description')}</th
          ><th>{t('expense.category')}</th><th>{t('ticket.project')}</th><th class="lx-num"
            >{t('expense.amount')}</th
          ><th>{t('common.status')}</th><th></th></tr
        ></thead
      >
      <tbody>
        {#each list as x (x.id)}
          <tr>
            <td>{date(x.date)}</td>
            <td>{x.vendor}</td>
            <td
              ><button
                type="button"
                class="lx-link"
                onclick={() => api.openForm({ kind: 'expense', id: x.id })}>{x.description}</button
              >{#if x.receipt}<span class="lx-muted"> 📎</span>{/if}</td
            >
            <td>{x.category}</td>
            <td>{api.ctx.index.get('project', x.project_id)?.name ?? '—'}</td>
            <td class="lx-num">{money(x.amount_cents, x.currency)}</td>
            <td><StatusBadge prefix="billing.status" value={x.billing_status} /></td>
            <td class="lx-row-actions">
              {#if x.billing_status === 'unbilled'}<button
                  type="button"
                  onclick={() => api.run(() => setExpenseStatus(api.ctx, x.id, 'approved'))}
                  >{t('billing.approve')}</button
                >{/if}
              {#if x.billing_status === 'approved'}<button
                  type="button"
                  onclick={() => api.run(() => setExpenseStatus(api.ctx, x.id, 'unbilled'))}
                  >{t('billing.unapprove')}</button
                >{/if}
              <button
                type="button"
                class="lx-icon-btn"
                aria-label={t('common.openNote')}
                onclick={() => api.openNote(x.id)}>↗</button
              >
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>
