<script lang="ts">
  import { msg } from '@/shared/i18n';
  import { dep } from '../components/labels';
  import type { UiApi } from '../stores/ui-api';
  import { t } from '@/shared/i18n';
  import { localDate, addDays, startOfWeek, parseIso, type IsoDate } from '@/shared/date/time';
  import { exportTimesheetCsv } from '@/application/use-cases/finance';
  import { dur, date } from '../components/labels';
  import EntryTable from './EntryTable.svelte';
  import Stat from '../components/Stat.svelte';

  let { api }: { api: UiApi } = $props();
  const version = api.version;
  let from = $state<IsoDate>(startOfWeek(localDate(Date.now())));
  let to = $state<IsoDate>(addDays(startOfWeek(localDate(Date.now())), 6));
  let project = $state('');
  let billable = $state<'' | 'yes' | 'no'>('');
  let groupByDay = $state(true);

  const projects = $derived(
    dep($version, () =>
      api.ctx.index
        .all('project')
        .filter((p) => !p.archived)
        .sort((a, b) => a.name.localeCompare(b.name)),
    ),
  );
  const entries = $derived.by(() => {
    void $version;
    return api.ctx.index
      .all('time_entry')
      .filter((e) => !e.archived)
      .filter((e) => {
        const d = localDate(parseIso(e.started_at));
        return (
          d >= from &&
          d <= to &&
          (!project || e.project_id === project) &&
          (!billable || e.billable === (billable === 'yes'))
        );
      })
      .sort((a, b) => b.started_at.localeCompare(a.started_at));
  });
  const days = $derived.by(() => {
    const m = new Map<string, typeof entries>();
    for (const e of entries) {
      const d = localDate(parseIso(e.started_at));
      m.set(d, [...(m.get(d) ?? []), e]);
    }
    return [...m.entries()];
  });
  const totals = $derived({
    tracked: entries.reduce((a, e) => a + e.duration_seconds, 0),
    billable: entries.filter((e) => e.billable).reduce((a, e) => a + e.duration_seconds, 0),
  });

  function shift(weeks: number) {
    from = addDays(from, weeks * 7);
    to = addDays(to, weeks * 7);
  }
</script>

<div class="lx-page">
  <div class="lx-toolbar">
    <h2>{t('nav.time')}</h2>
    <button
      type="button"
      class="lx-icon-btn"
      aria-label="−1 {t('common.week')}"
      onclick={() => shift(-1)}>‹</button
    >
    <input type="date" bind:value={from} aria-label={t('common.from')} />
    <input type="date" bind:value={to} aria-label={t('common.to')} />
    <button
      type="button"
      class="lx-icon-btn"
      aria-label="+1 {t('common.week')}"
      onclick={() => shift(1)}>›</button
    >
    <select bind:value={project} aria-label={t('ticket.project')}>
      <option value="">{t('ticket.project')}: {t('common.all')}</option>
      {#each projects as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
    </select>
    <select bind:value={billable} aria-label={t('ticket.billable')}>
      <option value="">{t('ticket.billable')}: {t('common.all')}</option>
      <option value="yes">{t('dash.billable')}</option>
      <option value="no">{t('dash.nonBillable')}</option>
    </select>
    <label class="lx-check"
      ><input type="checkbox" bind:checked={groupByDay} /> {t('time.date')}</label
    >
    <span class="lx-spacer"></span>
    <button
      type="button"
      onclick={() =>
        api.run(
          () => exportTimesheetCsv(api.ctx, from, to, project || null),
          msg('Export erstellt', 'Export created'),
        )}>{t('time.export')}</button
    >
    <button
      type="button"
      class="mod-cta"
      onclick={() => api.openForm({ kind: 'time', preset: { project_id: project || undefined } })}
      >{t('time.manual')}</button
    >
  </div>
  <div class="lx-stats">
    <Stat label={t('ticket.tracked')} value={dur(totals.tracked)} />
    <Stat label={t('dash.billable')} value={dur(totals.billable)} />
    <Stat label={t('dash.nonBillable')} value={dur(totals.tracked - totals.billable)} />
  </div>
  {#if groupByDay && entries.length}
    {#each days as [d, list] (d)}
      <h4 class="lx-day-head">
        {date(d)}
        <span class="lx-muted">Σ {dur(list.reduce((a, e) => a + e.duration_seconds, 0))}</span>
      </h4>
      <EntryTable {api} entries={list} />
    {/each}
  {:else}
    <EntryTable {api} {entries} />
  {/if}
</div>
