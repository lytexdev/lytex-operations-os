<script lang="ts">
  import type { UiApi } from '../stores/ui-api';
  import { t } from '@/shared/i18n';
  import { localDate, addDays, formatDuration } from '@/shared/date/time';
  import {
    totalsBetween,
    periodRanges,
    financeSummary,
    dailySeries,
    projectTotals,
  } from '@/application/queries/aggregates';
  import { filterTickets, isOverdue } from '@/application/queries/tickets';
  import { recentActivity } from '@/application/queries/timeline';
  import { entityTitle } from '@/application/queries/search';
  import { evaluateBudgets } from '@/domain/services/budget';
  import { sessionElapsedSeconds } from '@/domain/services/timer';
  import { money, hours, date, dateTime, dur } from '../components/labels';
  import Stat from '../components/Stat.svelte';
  import Section from '../components/Section.svelte';
  import BarChart from '../components/BarChart.svelte';
  import Progress from '../components/Progress.svelte';
  import Empty from '../components/Empty.svelte';

  let { api }: { api: UiApi } = $props();
  const version = api.version;
  const timer = api.timer;
  const now = api.now;

  const today = $derived(localDate($now));
  const data = $derived.by(() => {
    void $version;
    const idx = api.ctx.index;
    const s = api.settings();
    const r = periodRanges(today);
    const open = filterTickets(
      idx,
      s.workflow,
      { preset: 'all' },
      today,
      s.defaultAssignee,
      s.dueSoonDays,
    );
    const overdue = open.filter((tk) => isOverdue(tk, s.workflow, today));
    const activeProjects = idx.all('project').filter((p) => !p.archived && p.status === 'active');
    const warnings = activeProjects
      .flatMap((p) =>
        evaluateBudgets(p, projectTotals(idx, p.id), s.budgetThresholds)
          .filter((b) => b.reachedThreshold !== null && b.reachedThreshold >= 75)
          .map((b) => ({ p, b })),
      )
      .sort((a, b) => b.b.ratio - a.b.ratio);
    const soon = addDays(today, 14);
    const deadlines = [
      ...open
        .filter((tk) => tk.due_date && tk.due_date <= soon)
        .map((tk) => ({
          id: tk.id,
          route: 'ticket' as const,
          title: `${tk.ticket_number} ${tk.title}`,
          due: tk.due_date!,
          overdue: tk.due_date! < today,
        })),
      ...activeProjects
        .filter((p) => p.deadline && p.deadline <= soon)
        .map((p) => ({
          id: p.id,
          route: 'project' as const,
          title: p.name,
          due: p.deadline!,
          overdue: p.deadline! < today,
        })),
    ].sort((a, b) => a.due.localeCompare(b.due));
    return {
      today: totalsBetween(idx, ...r.today),
      week: totalsBetween(idx, ...r.week),
      month: totalsBetween(idx, ...r.month),
      fin: financeSummary(idx),
      open: open.length,
      overdue: overdue.length,
      activeProjects: activeProjects.length,
      warnings,
      deadlines: deadlines.slice(0, 10),
      series: dailySeries(idx, addDays(today, -13), 14),
      recent: recentActivity(idx, 10).map((a) => ({
        ...a,
        ...entityTitle(idx, idx.record(a.id)!.entity),
      })),
      empty: idx.all('customer').length === 0 && idx.all('project').length === 0,
      issues: idx.issues().filter((i) => i.severity === 'error').length,
    };
  });

  const timerProject = $derived(
    $timer ? api.ctx.index.get('project', $timer.project_id) : undefined,
  );
  const timerTicket = $derived($timer ? api.ctx.index.get('ticket', $timer.ticket_id) : undefined);
  const ROUTES = {
    customer: 'customer',
    project: 'project',
    ticket: 'ticket',
    billing_batch: 'batch',
    quote: 'quote',
    time_entry: 'time',
    expense: 'expenses',
    interaction: 'customer',
  } as const;
  function openRecent(type: string, id: string) {
    const r = ROUTES[type as keyof typeof ROUTES];
    if (!r) return;
    if (r === 'time' || r === 'expenses') api.router.go({ name: r });
    else if (type === 'interaction')
      api.router.go({
        name: 'customer',
        id: api.ctx.index.get('interaction', id)?.customer_id ?? '',
      });
    else api.router.go({ name: r, id });
  }

  // First start: no owner configured yet → ask for the user's name (used for "My work").
  let hasOwner = $state(!!api.settings().me);
  let ownerName = $state('');
  async function saveOwner() {
    const name = ownerName.trim().replace(/\s+/g, ' ');
    if (!name) return;
    const s = api.settings();
    s.me = name;
    if (!s.team.includes(name)) s.team = [name, ...s.team];
    if (!s.defaultAssignee) s.defaultAssignee = name;
    await api.saveSettings();
    hasOwner = true;
  }
</script>

<div class="lx-page">
  {#if !hasOwner}
    <form
      class="lx-callout lx-onboarding"
      onsubmit={(e) => {
        e.preventDefault();
        void saveOwner();
      }}
    >
      <strong>{t('onboarding.title')}</strong>
      <p>{t('onboarding.text')}</p>
      <div class="lx-inline-form">
        <input
          type="text"
          bind:value={ownerName}
          placeholder={t('onboarding.name')}
          aria-label={t('onboarding.name')}
        />
        <button type="submit" class="mod-cta" disabled={!ownerName.trim()}
          >{t('onboarding.start')}</button
        >
      </div>
    </form>
  {/if}
  {#if data.issues > 0}
    <div class="lx-callout lx-tone-danger">
      {t('dash.dataIssues', { n: data.issues })}
      <button type="button" class="lx-link" onclick={() => api.router.go({ name: 'health' })}
        >{t('nav.health')} →</button
      >
    </div>
  {/if}

  {#if data.empty}
    <Empty text={t('dash.empty')}>
      <button type="button" class="mod-cta" onclick={() => api.openForm({ kind: 'customer' })}
        >{t('customer.new')}</button
      >
      <button
        type="button"
        onclick={() => api.openForm({ kind: 'project', preset: { billing_model: 'internal' } })}
        >{t('project.new')} ({t('common.internal')})</button
      >
    </Empty>
  {/if}

  <div class="lx-timer-card" class:is-running={$timer?.state === 'running'}>
    <div>
      <div class="lx-stat-label">{t('dash.runningTimer')}</div>
      {#if $timer}
        <div class="lx-timer-big">{formatDuration(sessionElapsedSeconds($timer, $now), true)}</div>
        <div class="lx-muted">
          {timerProject?.name ?? '—'}{timerTicket
            ? ` · ${timerTicket.ticket_number} ${timerTicket.title}`
            : ''} · {t(`timer.${$timer.state}` as never)}
        </div>
      {:else}
        <div class="lx-muted">{t('dash.noTimer')}</div>
      {/if}
    </div>
    <div class="lx-actions">
      {#if $timer}
        <button type="button" onclick={() => api.openTimerPanel()}>{t('timer.title')}</button>
        <button type="button" class="mod-cta" onclick={() => api.stopTimer()}
          >{t('timer.stop')}</button
        >
      {:else}
        <button type="button" class="mod-cta" onclick={() => api.openTimerPanel()}
          >{t('timer.start')}</button
        >
      {/if}
    </div>
  </div>

  <div class="lx-stats">
    <Stat
      label={t('dash.today')}
      value={dur(data.today.trackedSeconds)}
      hint="{t('dash.billable')}: {dur(data.today.billableSeconds)}"
      onclick={() => api.router.go({ name: 'time' })}
    />
    <Stat
      label={t('dash.week')}
      value={dur(data.week.trackedSeconds)}
      hint="{t('dash.billable')}: {dur(data.week.billableSeconds)} · {t('dash.nonBillable')}: {dur(
        data.week.nonBillableSeconds,
      )}"
    />
    <Stat
      label={t('dash.month')}
      value={dur(data.month.trackedSeconds)}
      hint="{t('dash.billable')}: {dur(data.month.billableSeconds)} · {money(
        data.month.billableValueCents,
      )}"
    />
    <Stat
      label={t('dash.unbilledValue')}
      value={money(data.fin.unbilledValueCents)}
      hint="{t('billing.status.approved')}: {money(data.fin.approvedValueCents)}"
      tone="brand"
      onclick={() => api.router.go({ name: 'billing' })}
    />
    <Stat
      label={t('dash.openTickets')}
      value={String(data.open)}
      onclick={() => api.router.go({ name: 'tickets', params: { preset: 'all' } })}
    />
    <Stat
      label={t('dash.overdue')}
      value={String(data.overdue)}
      tone={data.overdue ? 'danger' : 'default'}
      onclick={() => api.router.go({ name: 'tickets', params: { preset: 'overdue' } })}
    />
    <Stat
      label={t('dash.activeProjects')}
      value={String(data.activeProjects)}
      onclick={() => api.router.go({ name: 'projects' })}
    />
  </div>

  <div class="lx-grid-2">
    <Section title={t('dash.last14')}>
      <BarChart
        items={data.series.map((d) => ({
          label: date(d.date),
          value: d.tracked,
          value2: d.billable,
        }))}
        format={(v) => `${hours(v)} h`}
        legend={[t('ticket.tracked'), t('dash.billable')]}
      />
    </Section>
    <Section title={t('dash.budgetWarnings')}>
      {#each data.warnings as w (w.p.id + w.b.kind)}
        <button
          type="button"
          class="lx-row-btn"
          onclick={() => api.router.go({ name: 'project', id: w.p.id })}
        >
          <Progress
            ratio={w.b.ratio}
            label="{w.p.name} – {w.b.label}"
            detail={w.b.kind === 'money'
              ? `${money(w.b.used)} / ${money(w.b.total)}`
              : `${dur(w.b.used)} / ${dur(w.b.total)}`}
          />
        </button>
      {:else}
        <p class="lx-muted">—</p>
      {/each}
    </Section>
    <Section title={t('dash.deadlines')}>
      <ul class="lx-list">
        {#each data.deadlines as d (d.id)}
          <li>
            <button
              type="button"
              class="lx-link"
              onclick={() => api.router.go({ name: d.route, id: d.id })}>{d.title}</button
            >
            <span class:lx-danger={d.overdue} class="lx-muted">{date(d.due)}</span>
          </li>
        {:else}
          <li class="lx-muted">—</li>
        {/each}
      </ul>
    </Section>
    <Section title={t('dash.recent')}>
      <ul class="lx-list">
        {#each data.recent as r (r.id)}
          <li>
            <button type="button" class="lx-link" onclick={() => openRecent(r.type, r.id)}
              >{r.title}</button
            >
            <span class="lx-muted">{dateTime(r.at)}</span>
          </li>
        {:else}
          <li class="lx-muted">—</li>
        {/each}
      </ul>
    </Section>
  </div>
</div>
