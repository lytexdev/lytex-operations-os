<script lang="ts">
  import { msg } from '@/shared/i18n';
  import { confirmDelete } from '../components/delete';
  import type { UiApi } from '../stores/ui-api';
  import type { TimeEntry } from '@/domain/schemas/entities';
  import { t } from '@/shared/i18n';
  import { isBillingLocked } from '@/domain/policies/billing-status';
  import { archiveEntry } from '@/application/use-cases/time';
  import { formatLocalTime, parseIso } from '@/shared/date/time';
  import { money, dur, date, label } from '../components/labels';
  import { entryValueCents } from '@/application/queries/aggregates';
  import StatusBadge from '../components/StatusBadge.svelte';
  import Empty from '../components/Empty.svelte';

  let {
    api,
    entries,
    selectable = false,
    selected = $bindable([]),
  }: { api: UiApi; entries: TimeEntry[]; selectable?: boolean; selected?: string[] } = $props();
  const version = api.version;
  const names = $derived.by(() => {
    void $version;
    const idx = api.ctx.index;
    return {
      project: (id: string) => idx.get('project', id)?.name ?? id,
      ticket: (id: string | null) => {
        const tk = idx.get('ticket', id);
        return tk ? `${tk.ticket_number} ${tk.title}` : '';
      },
    };
  });

  function toggle(id: string) {
    selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
  }
  function toggleAll() {
    selected = selected.length === entries.length ? [] : entries.map((e) => e.id);
  }
  async function archive(e: TimeEntry) {
    if (await api.confirm(t('common.archive'), `${date(e.started_at)} ${e.description}`))
      await api.run(() => archiveEntry(api.ctx, e.id), t('common.saved'));
  }
</script>

{#if entries.length === 0}
  <Empty text={t('time.empty')} />
{:else}
  <table class="lx-table lx-table-compact">
    <thead>
      <tr>
        {#if selectable}<th
            ><input
              type="checkbox"
              checked={selected.length === entries.length}
              onchange={toggleAll}
              aria-label={t('common.select')}
            /></th
          >{/if}
        <th>{t('time.date')}</th>
        <th>{t('time.start')}–{t('time.end')}</th>
        <th class="lx-num">{t('ticket.tracked')}</th>
        <th>{t('ticket.project')} / Ticket</th>
        <th>{t('common.description')}</th>
        <th class="lx-num">€</th>
        <th>{t('common.status')}</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      {#each entries as e (e.id)}
        <tr class:is-nonbillable={!e.billable}>
          {#if selectable}<td
              ><input
                type="checkbox"
                checked={selected.includes(e.id)}
                onchange={() => toggle(e.id)}
                aria-label={t('common.select')}
              /></td
            >{/if}
          <td>{date(e.started_at)}</td>
          <td class="lx-mono"
            >{e.source === 'adjustment'
              ? '—'
              : `${formatLocalTime(parseIso(e.started_at))}–${formatLocalTime(parseIso(e.ended_at))}`}</td
          >
          <td class="lx-num lx-mono">{dur(e.duration_seconds)}</td>
          <td>
            <button
              type="button"
              class="lx-link"
              onclick={() => api.router.go({ name: 'project', id: e.project_id })}
              >{names.project(e.project_id)}</button
            >
            {#if e.ticket_id}<br /><button
                type="button"
                class="lx-link lx-muted"
                onclick={() => api.router.go({ name: 'ticket', id: e.ticket_id! })}
                >{names.ticket(e.ticket_id)}</button
              >{/if}
          </td>
          <td
            >{e.description}{#if e.overlap_acknowledged}<span
                class="lx-badge lx-badge-warn"
                title={msg('Überschneidung bestätigt', 'Overlap acknowledged')}>⇄</span
              >{/if}{#if e.source === 'recovery'}<span class="lx-badge lx-badge-info">↺</span
              >{/if}</td
          >
          <td class="lx-num">{e.billable ? money(entryValueCents(e), e.currency) : '—'}</td>
          <td
            ><StatusBadge
              prefix="billing.status"
              value={e.billable ? e.billing_status : 'not_billable'}
            /></td
          >
          <td class="lx-row-actions">
            {#if !isBillingLocked(e.billing_status) && e.source !== 'adjustment'}
              <button
                type="button"
                class="lx-icon-btn"
                title={t('common.edit')}
                aria-label={t('common.edit')}
                onclick={() => api.openForm({ kind: 'time', id: e.id })}>✎</button
              >
              <button
                type="button"
                class="lx-icon-btn"
                title={t('common.archive')}
                aria-label={t('common.archive')}
                onclick={() => archive(e)}>🗄</button
              >
              <button
                type="button"
                class="lx-icon-btn"
                title={t('common.delete')}
                aria-label={t('common.delete')}
                onclick={() =>
                  confirmDelete(
                    api,
                    'time_entry',
                    e.id,
                    `${date(e.started_at)} ${e.description || dur(e.duration_seconds)}`,
                  )}>🗑</button
              >
            {:else if e.billing_status === 'invoiced' || e.billing_status === 'adjusted'}
              <button
                type="button"
                class="lx-icon-btn"
                title={t('time.adjust')}
                aria-label={t('time.adjust')}
                onclick={() => api.openForm({ kind: 'adjust', id: e.id })}>±</button
              >
            {/if}
            <button
              type="button"
              class="lx-icon-btn"
              title={t('common.openNote')}
              aria-label={t('common.openNote')}
              onclick={() => api.openNote(e.id)}>↗</button
            >
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
  <p class="lx-muted lx-small">
    {label('billing.status', 'unbilled')}: {entries.filter((e) => e.billing_status === 'unbilled')
      .length} · Σ {dur(entries.reduce((a, e) => a + e.duration_seconds, 0))}
  </p>
{/if}
