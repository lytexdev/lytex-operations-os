<script lang="ts">
  import { msg } from '@/shared/i18n';
  import { dep } from '../components/labels';
  import type { UiApi } from '../stores/ui-api';
  import { t } from '@/shared/i18n';
  import { formatDuration, localDate, parseIso } from '@/shared/date/time';
  import { sessionElapsedSeconds } from '@/domain/services/timer';
  import { isClosed } from '@/domain/policies/workflow';
  import { activeEntries } from '@/application/queries/aggregates';
  import { dur } from '../components/labels';

  let { api }: { api: UiApi } = $props();
  const version = api.version;
  const timer = api.timer;
  const now = api.now;

  let project = $state('');
  let ticket = $state('');
  let note = $state('');
  let billable = $state(true);

  // Keep local form in sync with the running session.
  $effect(() => {
    const s = $timer;
    if (s) {
      project = s.project_id ?? '';
      ticket = s.ticket_id ?? '';
      note = s.description;
      billable = s.billable;
    }
  });

  const projects = $derived(
    dep($version, () =>
      api.ctx.index
        .all('project')
        .filter(
          (p) =>
            !p.archived && (p.status === 'active' || p.status === 'planned' || p.id === project),
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    ),
  );
  const tickets = $derived.by(() => {
    void $version;
    const wf = api.settings().workflow;
    return api.ctx.index
      .all('ticket')
      .filter(
        (x) =>
          x.project_id === project && !x.archived && (!isClosed(wf, x.status) || x.id === ticket),
      );
  });
  const selectedProject = $derived(api.ctx.index.get('project', project));
  const today = $derived(localDate($now));
  const todayEntries = $derived(
    dep($version, () =>
      activeEntries(api.ctx.index)
        .filter((e) => e.source !== 'adjustment' && localDate(parseIso(e.started_at)) === today)
        .sort((a, b) => b.started_at.localeCompare(a.started_at)),
    ),
  );
  const elapsed = $derived($timer ? sessionElapsedSeconds($timer, $now) : 0);
  const todayTotal = $derived(todayEntries.reduce((a, e) => a + e.duration_seconds, 0) + elapsed);
  const recentTickets = $derived.by(() => {
    void $version;
    const seen = new Set<string>();
    const out: { project_id: string; ticket_id: string | null; label: string }[] = [];
    for (const e of [...activeEntries(api.ctx.index)].sort((a, b) =>
      b.started_at.localeCompare(a.started_at),
    )) {
      const key = `${e.project_id}|${e.ticket_id ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const p = api.ctx.index.get('project', e.project_id);
      if (!p || p.archived) continue;
      const tk = api.ctx.index.get('ticket', e.ticket_id);
      out.push({
        project_id: e.project_id,
        ticket_id: e.ticket_id,
        label: tk ? `${tk.ticket_number} ${tk.title}` : p.name,
      });
      if (out.length >= 5) break;
    }
    return out;
  });

  async function start() {
    if (!project) {
      api.notify(t('timer.project') + ': ' + t('common.required'), 'error');
      return;
    }
    await api.startTimer({
      project_id: project,
      ticket_id: ticket || null,
      description: note,
      billable,
    });
  }

  function update(patch: Record<string, unknown>) {
    if ($timer) void api.run(() => api.core.timer.update(patch));
  }

  async function discard() {
    if (await api.confirm(t('timer.discard'), t('timer.discardConfirm'), t('timer.discard')))
      await api.run(() => api.core.timer.discard());
  }
</script>

<div class="lx-timer-panel">
  <div class="lx-timer-display lx-state-{$timer?.state ?? 'idle'}">
    <div class="lx-timer-big" aria-live="polite">{formatDuration(elapsed, true)}</div>
    <div class="lx-muted">{$timer ? t(`timer.${$timer.state}` as never) : t('timer.idle')}</div>
  </div>

  {#if $timer?.state === 'recovering'}
    <div class="lx-callout lx-tone-warn">
      {t('timer.recovering')}
      <button type="button" class="mod-cta" onclick={() => api.openRecovery()}
        >{t('timer.recovery.title')}</button
      >
    </div>
  {/if}

  <label class="lx-field"
    ><span class="lx-field-label">{t('timer.project')}</span>
    <select
      bind:value={project}
      onchange={() => {
        ticket = '';
        billable = selectedProject?.billing_model !== 'internal';
        update({
          project_id: project || null,
          ticket_id: null,
          customer_id: selectedProject?.customer_id ?? null,
          billable,
        });
      }}
      disabled={$timer?.state === 'stopping'}
    >
      <option value="">—</option>
      {#each projects as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
    </select>
  </label>
  <label class="lx-field"
    ><span class="lx-field-label">{t('timer.ticket')}</span>
    <select
      bind:value={ticket}
      onchange={() => {
        const tk = api.ctx.index.get('ticket', ticket);
        if (tk && !tk.billable) billable = false;
        update({ ticket_id: ticket || null, billable });
      }}
      disabled={!project || $timer?.state === 'stopping'}
    >
      <option value="">—</option>
      {#each tickets as x (x.id)}<option value={x.id}>{x.ticket_number} {x.title}</option>{/each}
    </select>
  </label>
  <label class="lx-field"
    ><span class="lx-field-label">{t('timer.note')}</span>
    <textarea rows="2" bind:value={note} onchange={() => update({ description: note })}></textarea>
  </label>
  <label class="lx-check"
    ><input
      type="checkbox"
      bind:checked={billable}
      disabled={selectedProject?.billing_model === 'internal'}
      onchange={() => update({ billable })}
    />
    {t('ticket.billable')}</label
  >

  <div class="lx-timer-buttons">
    {#if !$timer}
      <button type="button" class="mod-cta lx-big-btn" onclick={start}>▶ {t('timer.start')}</button>
    {:else if $timer.state === 'running'}
      <button type="button" class="lx-big-btn" onclick={() => api.run(() => api.core.timer.pause())}
        >⏸ {t('timer.pause')}</button
      >
      <button type="button" class="mod-cta lx-big-btn" onclick={() => api.stopTimer()}
        >■ {t('timer.stop')}</button
      >
    {:else if $timer.state === 'paused'}
      <button
        type="button"
        class="lx-big-btn"
        onclick={() => api.run(() => api.core.timer.resume())}>▶ {t('timer.resume')}</button
      >
      <button type="button" class="mod-cta lx-big-btn" onclick={() => api.stopTimer()}
        >■ {t('timer.stop')}</button
      >
    {/if}
    {#if $timer && $timer.state !== 'stopping'}<button
        type="button"
        class="mod-warning"
        onclick={discard}>{t('timer.discard')}</button
      >{/if}
  </div>

  {#if $timer && $timer.segments.length > 1}
    <p class="lx-small lx-muted">{$timer.segments.length} {msg('Segmente', 'segments')}</p>
  {/if}

  <div class="lx-timer-section">
    <div class="lx-section-head">
      <h4>{t('timer.todayTotal')}</h4>
      <strong>{dur(todayTotal)}</strong>
    </div>
    <ul class="lx-list lx-small">
      {#each todayEntries.slice(0, 8) as e (e.id)}
        <li>
          <button
            type="button"
            class="lx-link"
            onclick={() => api.openForm({ kind: 'time', id: e.id })}
            >{e.description ||
              api.ctx.index.get('ticket', e.ticket_id)?.title ||
              api.ctx.index.get('project', e.project_id)?.name}</button
          ><span>{dur(e.duration_seconds)}</span>
        </li>
      {/each}
    </ul>
  </div>

  {#if !$timer && recentTickets.length}
    <div class="lx-timer-section">
      <h4>{msg('Zuletzt', 'Recent')}</h4>
      <ul class="lx-list lx-small">
        {#each recentTickets as r (r.project_id + (r.ticket_id ?? ''))}
          <li>
            <span>{r.label}</span><button
              type="button"
              class="lx-icon-btn"
              aria-label={t('timer.start')}
              onclick={() => api.startTimer({ project_id: r.project_id, ticket_id: r.ticket_id })}
              >▶</button
            >
          </li>
        {/each}
      </ul>
    </div>
  {/if}
  <button type="button" class="lx-link lx-small" onclick={() => api.openForm({ kind: 'time' })}
    >+ {t('time.manual')}</button
  >
</div>
