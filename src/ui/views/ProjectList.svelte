<script lang="ts">
  import type { UiApi } from '../stores/ui-api';
  import { t } from '@/shared/i18n';
  import { PROJECT_STATUSES, BILLING_MODELS } from '@/domain/schemas/entities';
  import { normalize } from '@/shared/utilities/text';
  import { projectTotals } from '@/application/queries/aggregates';
  import { evaluateBudgets } from '@/domain/services/budget';
  import { dur, date, label } from '../components/labels';
  import StatusBadge from '../components/StatusBadge.svelte';
  import Progress from '../components/Progress.svelte';
  import Empty from '../components/Empty.svelte';

  let { api }: { api: UiApi } = $props();
  const version = api.version;
  let text = $state('');
  let status = $state('active');
  let model = $state('');
  let showArchived = $state(false);

  const rows = $derived.by(() => {
    void $version;
    const idx = api.ctx.index;
    const s = api.settings();
    const q = normalize(text);
    return idx
      .all('project')
      .filter(
        (p) =>
          (showArchived || !p.archived) &&
          (!status || p.status === status) &&
          (!model || p.billing_model === model),
      )
      .map((p) => {
        const c = idx.get('customer', p.customer_id);
        const totals = projectTotals(idx, p.id);
        const budgets = evaluateBudgets(p, totals, s.budgetThresholds);
        const worst = budgets.reduce(
          (m, b) => (b.ratio > (m?.ratio ?? -1) ? b : m),
          null as (typeof budgets)[number] | null,
        );
        return { p, c, totals, worst };
      })
      .filter(
        (r) =>
          !q ||
          normalize(
            `${r.p.name} ${r.p.project_number} ${r.p.key} ${r.c?.name ?? ''} ${r.p.tags.join(' ')}`,
          ).includes(q),
      )
      .sort(
        (a, b) =>
          (a.p.deadline ?? '9999').localeCompare(b.p.deadline ?? '9999') ||
          a.p.name.localeCompare(b.p.name),
      );
  });
</script>

<div class="lx-page">
  <div class="lx-toolbar">
    <h2>{t('nav.projects')}</h2>
    <input
      type="search"
      placeholder={t('common.search')}
      bind:value={text}
      aria-label={t('common.search')}
    />
    <select bind:value={status} aria-label={t('common.status')}>
      <option value="">{t('common.all')}</option>
      {#each PROJECT_STATUSES as s (s)}<option value={s}>{label('project.status', s)}</option
        >{/each}
    </select>
    <select bind:value={model} aria-label={t('project.billingModel')}>
      <option value="">{t('project.billingModel')}: {t('common.all')}</option>
      {#each BILLING_MODELS as m (m)}<option value={m}>{label('project.bm', m)}</option>{/each}
    </select>
    <label class="lx-check"
      ><input type="checkbox" bind:checked={showArchived} /> {t('common.showArchived')}</label
    >
    <span class="lx-spacer"></span>
    <button type="button" class="mod-cta" onclick={() => api.openForm({ kind: 'project' })}
      >{t('project.new')}</button
    >
  </div>
  {#if rows.length === 0}
    <Empty text={t('project.empty')} />
  {:else}
    <div class="lx-cards">
      {#each rows as r (r.p.id)}
        <button
          type="button"
          class="lx-card lx-clickable"
          class:is-archived={r.p.archived}
          onclick={() => api.router.go({ name: 'project', id: r.p.id })}
        >
          <div class="lx-card-head">
            <strong>{r.p.name}</strong>
            <StatusBadge prefix="project.status" value={r.p.status} />
          </div>
          <div class="lx-muted">
            {r.p.project_number} · {r.c?.name ?? t('common.internal')} · {label(
              'project.bm',
              r.p.billing_model,
            )}
          </div>
          <div class="lx-card-meta">
            <span>{t('ticket.tracked')}: {dur(r.totals.trackedSeconds)}</span>
            {#if r.p.deadline}<span>{t('project.deadline')}: {date(r.p.deadline)}</span>{/if}
          </div>
          {#if r.worst}<Progress ratio={r.worst.ratio} label={r.worst.label} detail="" />{/if}
        </button>
      {/each}
    </div>
  {/if}
</div>
