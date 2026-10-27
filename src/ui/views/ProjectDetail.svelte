<script lang="ts">
  import { msg } from '@/shared/i18n';
  import { dep } from '../components/labels';
  import type { UiApi } from '../stores/ui-api';
  import { t } from '@/shared/i18n';
  import {
    projectTotals,
    entriesByProject,
    projectExpenses,
    trackedSecondsByTicket,
  } from '@/application/queries/aggregates';
  import { evaluateBudgets, profitability } from '@/domain/services/budget';
  import { isClosed } from '@/domain/policies/workflow';
  import { addMilestone, toggleMilestone, removeMilestone } from '@/application/use-cases/projects';
  import { money, dur, date, label, pct } from '../components/labels';
  import Section from '../components/Section.svelte';
  import Stat from '../components/Stat.svelte';
  import Progress from '../components/Progress.svelte';
  import StatusBadge from '../components/StatusBadge.svelte';
  import Empty from '../components/Empty.svelte';
  import TicketsView from './TicketsView.svelte';
  import { confirmDelete } from '../components/delete';
  import EntryTable from './EntryTable.svelte';

  let {
    api,
    id,
    params = {},
  }: { api: UiApi; id: string; params?: Record<string, string> } = $props();
  const version = api.version;
  // svelte-ignore state_referenced_locally
  let tab = $state<'overview' | 'tickets' | 'time' | 'finance'>(
    (params['tab'] as 'overview' | 'tickets' | 'time' | 'finance') || 'overview',
  );
  // svelte-ignore state_referenced_locally
  const ticketParams = Object.fromEntries(
    Object.entries(params)
      .filter(([k]) => k.startsWith('t_'))
      .map(([k, v]) => [k.slice(2), v]),
  );
  $effect(() => api.router.patchParams({ tab }));
  let msTitle = $state('');
  let msDue = $state('');

  const p = $derived(dep($version, () => api.ctx.index.get('project', id)));
  const data = $derived.by(() => {
    void $version;
    if (!p) return null;
    const idx = api.ctx.index;
    const s = api.settings();
    const totals = projectTotals(idx, id);
    const tickets = idx.all('ticket').filter((tk) => tk.project_id === id && !tk.archived);
    const done = tickets.filter((tk) => isClosed(s.workflow, tk.status)).length;
    const tracked = trackedSecondsByTicket(idx);
    const estimated = tickets.reduce((a, tk) => a + (tk.estimated_seconds ?? 0), 0);
    const trackedOnEstimated = tickets
      .filter((tk) => tk.estimated_seconds)
      .reduce((a, tk) => a + (tracked.get(tk.id) ?? 0), 0);
    return {
      customer: idx.get('customer', p.customer_id),
      totals,
      budgets: evaluateBudgets(p, totals, s.budgetThresholds),
      profit: profitability(p, totals, s.internalCostRateCents),
      ticketCount: tickets.length,
      done,
      estimated,
      trackedOnEstimated,
      entries: [...(entriesByProject(idx).get(id) ?? [])].sort((a, b) =>
        b.started_at.localeCompare(a.started_at),
      ),
      expenses: projectExpenses(idx, id),
      batches: idx.all('billing_batch').filter((b) => b.project_ids.includes(id)),
      recurring: idx.all('recurring_task').filter((r) => r.project_id === id),
    };
  });

  async function addMs() {
    if (!msTitle.trim()) return;
    await api.run(() => addMilestone(api.ctx, id, msTitle, msDue || null));
    msTitle = '';
    msDue = '';
  }
</script>

{#if !p || !data}
  <Empty text={msg('Projekt nicht gefunden.', 'Project not found.')} />
{:else}
  <div class="lx-page">
    <div class="lx-detail-head">
      <div>
        <h2>{p.name} <StatusBadge prefix="project.status" value={p.status} /></h2>
        <div class="lx-muted">
          {p.project_number} · {p.key} ·
          {#if data.customer}<button
              type="button"
              class="lx-link"
              onclick={() => api.router.go({ name: 'customer', id: data.customer!.id })}
              >{data.customer.name}</button
            >{:else}{t('common.internal')}{/if}
          · {label('project.bm', p.billing_model)}
        </div>
      </div>
      <div class="lx-actions">
        <button type="button" onclick={() => api.openForm({ kind: 'project', id: p.id })}
          >{t('common.edit')}</button
        >
        <button type="button" onclick={() => api.openNote(p.id)}>{t('common.openNote')}</button>
        <button
          type="button"
          onclick={() =>
            api.run(() => api.ctx.repo.archive('project', p.id, !p.archived), t('common.saved'))}
          >{p.archived ? t('common.unarchive') : t('common.archive')}</button
        >
        <button
          type="button"
          class="mod-warning"
          onclick={async () => {
            if (await confirmDelete(api, 'project', p.id, p.name))
              api.router.go({ name: 'projects' });
          }}>{t('common.delete')}</button
        >
        <button type="button" onclick={() => api.startTimer({ project_id: p.id })}
          >▶ {t('ticket.startTimer')}</button
        >
        <button
          type="button"
          class="mod-cta"
          onclick={() => api.openForm({ kind: 'ticket', preset: { project_id: p.id } })}
          >{t('ticket.new')}</button
        >
      </div>
    </div>

    <div class="lx-tabs" role="tablist">
      {#each [['overview', t('project.overview')], ['tickets', t('project.tickets')], ['time', t('project.time')], ['finance', t('project.finance')]] as [k, l] (k)}
        <button
          type="button"
          role="tab"
          aria-selected={tab === k}
          class:is-active={tab === k}
          onclick={() => (tab = k as typeof tab)}>{l}</button
        >
      {/each}
    </div>

    {#if tab === 'overview'}
      <div class="lx-stats">
        <Stat
          label={t('ticket.tracked')}
          value={dur(data.totals.trackedSeconds)}
          hint="{t('dash.billable')}: {dur(data.totals.billableSeconds)} · {t(
            'dash.nonBillable',
          )}: {dur(data.totals.nonBillableSeconds)}"
        />
        <Stat
          label={t('project.revenue')}
          value={money(data.profit.revenueCents, p.currency)}
          hint={data.profit.revenueBasis === 'fixed_price'
            ? t('project.fixedPrice')
            : msg('Abrechenbarer Wert (projiziert)', 'Billable value (projected)')}
          tone="brand"
        />
        <Stat
          label={t('project.margin')}
          value={money(data.profit.marginCents, p.currency)}
          hint="{t('project.cost')}: {money(data.profit.internalCostCents)}"
          tone={data.profit.marginCents < 0 ? 'danger' : 'ok'}
        />
        <Stat
          label={t('project.effectiveRate')}
          value={data.profit.effectiveHourlyCents != null
            ? money(data.profit.effectiveHourlyCents)
            : '—'}
        />
        <Stat
          label={t('analytics.completion')}
          value="{data.done} / {data.ticketCount}"
          hint={data.ticketCount ? pct(data.done / data.ticketCount) : ''}
        />
      </div>
      <div class="lx-grid-2">
        <Section title={t('project.budgets')}>
          {#each data.budgets as b (b.kind)}
            <Progress
              ratio={b.ratio}
              label={b.label}
              detail={b.kind === 'money'
                ? `${money(b.used)} / ${money(b.total)}`
                : `${dur(b.used)} / ${dur(b.total)}`}
            />
          {:else}
            <p class="lx-muted">{msg('Kein Budget hinterlegt.', 'No budget set.')}</p>
          {/each}
          <h4>{t('project.estVsActual')}</h4>
          <p>
            {t('ticket.estimate')}: {dur(data.estimated)} · {t('ticket.tracked')} ({msg(
              'auf geschätzten Tickets',
              'on estimated tickets',
            )}):
            {dur(data.trackedOnEstimated)}
          </p>
          {#if data.estimated > 0}<Progress
              ratio={data.trackedOnEstimated / data.estimated}
              label={t('project.estVsActual')}
              detail=""
            />{/if}
        </Section>
        <Section title={t('project.milestones')}>
          <ul class="lx-list">
            {#each p.milestones as m (m.id)}
              <li>
                <label class="lx-check"
                  ><input
                    type="checkbox"
                    checked={m.done}
                    onchange={() => api.run(() => toggleMilestone(api.ctx, id, m.id))}
                  /> <span class:lx-done={m.done}>{m.title}</span></label
                >
                <span class="lx-muted"
                  >{date(m.due_date)}
                  <button
                    type="button"
                    class="lx-icon-btn"
                    aria-label={t('common.delete')}
                    onclick={async () =>
                      (await api.confirm(t('common.delete'), m.title)) &&
                      api.run(() => removeMilestone(api.ctx, id, m.id))}>✕</button
                  ></span
                >
              </li>
            {:else}<li class="lx-muted">—</li>{/each}
          </ul>
          <form
            class="lx-inline-form"
            onsubmit={(e) => {
              e.preventDefault();
              addMs();
            }}
          >
            <input
              type="text"
              placeholder={t('project.addMilestone')}
              bind:value={msTitle}
              aria-label={t('project.addMilestone')}
            />
            <input type="date" bind:value={msDue} aria-label={t('project.deadline')} />
            <button type="submit">+</button>
          </form>
        </Section>
        <Section title={t('common.description')}>
          <dl class="lx-dl">
            <dt>{t('project.start')}</dt>
            <dd>{date(p.start_date)}</dd>
            <dt>{t('project.deadline')}</dt>
            <dd>{date(p.deadline)}</dd>
            <dt>{t('project.rate')}</dt>
            <dd>{money(p.rate_cents)}</dd>
            {#if p.billing_unit === 'day'}<dt>{t('project.dailyRate')}</dt>
              <dd>{money(p.daily_rate_cents)}</dd>{/if}
            {#if p.billing_model === 'fixed_price'}<dt>{t('project.fixedPrice')}</dt>
              <dd>{money(p.fixed_price_cents)}</dd>{/if}
            {#if p.billing_model === 'retainer'}<dt>{t('project.retainerFee')}</dt>
              <dd>
                {money(p.retainer_monthly_fee_cents)} · {dur(p.retainer_included_seconds)} h
              </dd>{/if}
            <dt>{t('ticket.priority')}</dt>
            <dd>{label('priority', p.priority)}</dd>
          </dl>
        </Section>
        <Section title={t('project.docs')}>
          <ul class="lx-list">
            {#each p.doc_links as l (l)}
              <li>
                <button
                  type="button"
                  class="lx-link"
                  onclick={() => api.openNote(l.replace(/^\[\[|\]\]$/g, ''))}>{l}</button
                >
              </li>
            {:else}<li class="lx-muted">—</li>{/each}
          </ul>
          {#if data.recurring.length}
            <h4>{t('nav.recurring')}</h4>
            <ul class="lx-list">
              {#each data.recurring as r (r.id)}<li>{r.title}</li>{/each}
            </ul>
          {/if}
        </Section>
      </div>
    {:else if tab === 'tickets'}
      <TicketsView {api} projectId={id} params={ticketParams} />
    {:else if tab === 'time'}
      <div class="lx-toolbar">
        <span class="lx-spacer"></span><button
          type="button"
          class="mod-cta"
          onclick={() => api.openForm({ kind: 'time', preset: { project_id: id } })}
          >{t('time.manual')}</button
        >
      </div>
      <EntryTable {api} entries={data.entries} />
    {:else}
      <div class="lx-grid-2">
        <Section title={t('nav.expenses')}>
          {#snippet actions()}<button
              type="button"
              onclick={() => api.openForm({ kind: 'expense', preset: { project_id: id } })}
              >+</button
            >{/snippet}
          <ul class="lx-list">
            {#each data.expenses as x (x.id)}
              <li>
                <button
                  type="button"
                  class="lx-link"
                  onclick={() => api.openForm({ kind: 'expense', id: x.id })}
                  >{x.date} {x.description}</button
                ><span
                  >{money(x.amount_cents, x.currency)} · {label(
                    'billing.status',
                    x.billing_status,
                  )}</span
                >
              </li>
            {:else}<li class="lx-muted">—</li>{/each}
          </ul>
        </Section>
        <Section title={t('billing.batches')}>
          <ul class="lx-list">
            {#each data.batches as b (b.id)}
              <li>
                <button
                  type="button"
                  class="lx-link"
                  onclick={() => api.router.go({ name: 'batch', id: b.id })}
                  >{b.batch_number}</button
                ><span
                  ><StatusBadge prefix="batch.status" value={b.status} /> {money(b.net_cents)}</span
                >
              </li>
            {:else}<li class="lx-muted">—</li>{/each}
          </ul>
        </Section>
      </div>
    {/if}
  </div>
{/if}
