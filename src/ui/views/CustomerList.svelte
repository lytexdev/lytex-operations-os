<script lang="ts">
  import type { UiApi } from '../stores/ui-api';
  import { t } from '@/shared/i18n';
  import { CUSTOMER_STATUSES, type Customer } from '@/domain/schemas/entities';
  import { normalize } from '@/shared/utilities/text';
  import { customerProjects, financeSummary } from '@/application/queries/aggregates';
  import { entryValueCents } from '@/application/queries/aggregates';
  import { money } from '../components/labels';
  import StatusBadge from '../components/StatusBadge.svelte';
  import Empty from '../components/Empty.svelte';

  let { api }: { api: UiApi } = $props();
  const version = api.version;
  let text = $state('');
  let status = $state<string>('');
  let showArchived = $state(false);
  let sortKey = $state<'name' | 'number' | 'unbilled' | 'projects'>('name');

  const rows = $derived.by(() => {
    void $version;
    const idx = api.ctx.index;
    financeSummary(idx);
    const unbilled = new Map<string, number>();
    for (const e of idx.all('time_entry')) {
      if (!e.customer_id || e.archived || !e.billable) continue;
      if (e.billing_status === 'unbilled' || e.billing_status === 'approved')
        unbilled.set(e.customer_id, (unbilled.get(e.customer_id) ?? 0) + entryValueCents(e));
    }
    const q = normalize(text);
    return idx
      .all('customer')
      .filter((c) => (showArchived || !c.archived) && (!status || c.status === status))
      .filter(
        (c) =>
          !q ||
          normalize(
            `${c.name} ${c.customer_number} ${c.email} ${c.address.city} ${c.tags.join(' ')}`,
          ).includes(q),
      )
      .map((c: Customer) => ({
        c,
        projects: customerProjects(idx, c.id).filter((p) => !p.archived).length,
        unbilled: unbilled.get(c.id) ?? 0,
      }))
      .sort((a, b) => {
        switch (sortKey) {
          case 'number':
            return a.c.customer_number.localeCompare(b.c.customer_number, undefined, {
              numeric: true,
            });
          case 'unbilled':
            return b.unbilled - a.unbilled;
          case 'projects':
            return b.projects - a.projects;
          default:
            return a.c.name.localeCompare(b.c.name);
        }
      });
  });
</script>

<div class="lx-page">
  <div class="lx-toolbar">
    <h2>{t('nav.customers')}</h2>
    <input
      type="search"
      placeholder={t('common.search')}
      bind:value={text}
      aria-label={t('common.search')}
    />
    <select bind:value={status} aria-label={t('common.status')}>
      <option value="">{t('common.all')}</option>
      {#each CUSTOMER_STATUSES as s (s)}<option value={s}
          >{t(`customer.status.${s}` as never)}</option
        >{/each}
    </select>
    <label class="lx-check"
      ><input type="checkbox" bind:checked={showArchived} /> {t('common.showArchived')}</label
    >
    <span class="lx-spacer"></span>
    <button type="button" class="mod-cta" onclick={() => api.openForm({ kind: 'customer' })}
      >{t('customer.new')}</button
    >
  </div>

  {#if rows.length === 0}
    <Empty text={t('customer.empty')} />
  {:else}
    <table class="lx-table">
      <thead>
        <tr>
          <th
            ><button type="button" class="lx-th" onclick={() => (sortKey = 'number')}
              >{t('customer.number')}</button
            ></th
          >
          <th
            ><button type="button" class="lx-th" onclick={() => (sortKey = 'name')}
              >{t('customer.name')}</button
            ></th
          >
          <th>{t('common.status')}</th>
          <th>{t('customer.city')}</th>
          <th class="lx-num"
            ><button type="button" class="lx-th" onclick={() => (sortKey = 'projects')}
              >{t('nav.projects')}</button
            ></th
          >
          <th class="lx-num"
            ><button type="button" class="lx-th" onclick={() => (sortKey = 'unbilled')}
              >{t('dash.unbilledValue')}</button
            ></th
          >
        </tr>
      </thead>
      <tbody>
        {#each rows as r (r.c.id)}
          <tr
            class="lx-clickable"
            class:is-archived={r.c.archived}
            onclick={() => api.router.go({ name: 'customer', id: r.c.id })}
          >
            <td class="lx-mono">{r.c.customer_number}</td>
            <td
              ><button
                type="button"
                class="lx-link"
                onclick={(e) => {
                  e.stopPropagation();
                  api.router.go({ name: 'customer', id: r.c.id });
                }}>{r.c.name}</button
              ></td
            >
            <td><StatusBadge prefix="customer.status" value={r.c.status} /></td>
            <td>{r.c.address.city}</td>
            <td class="lx-num">{r.projects}</td>
            <td class="lx-num">{money(r.unbilled)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>
