<script lang="ts">
  import { msg } from '@/shared/i18n';
  import { dep } from '../components/labels';
  import type { UiApi } from '../stores/ui-api';
  import type { Ticket } from '@/domain/schemas/entities';
  import { PRIORITIES } from '@/domain/schemas/common';
  import { t } from '@/shared/i18n';
  import { filterTickets, isOverdue, type TicketPreset } from '@/application/queries/tickets';
  import { trackedSecondsByTicket } from '@/application/queries/aggregates';
  import {
    bulkStatus,
    bulkArchive,
    placeTicket,
    changeTicketStatus,
  } from '@/application/use-cases/tickets';
  import { localDate } from '@/shared/date/time';
  import { DomainError } from '@/domain/errors/errors';
  import { dur, date, label } from '../components/labels';
  import StatusBadge from '../components/StatusBadge.svelte';
  import Empty from '../components/Empty.svelte';

  let {
    api,
    projectId = null,
    params = {},
  }: { api: UiApi; projectId?: string | null; params?: Record<string, string> } = $props();
  const version = api.version;
  const now = api.now;

  const PRESETS: [TicketPreset, string][] = [
    ['mine', t('ticket.filter.mine')],
    ['all', t('ticket.filter.all')],
    ['dueSoon', t('ticket.filter.dueSoon')],
    ['overdue', t('ticket.filter.overdue')],
    ['completed', t('ticket.filter.completed')],
    ['everything', t('ticket.filter.everything')],
  ];
  const remember = (k: string, v?: string): string | null => {
    try {
      if (v !== undefined) localStorage.setItem(`lytex-ops:${k}`, v);
      return localStorage.getItem(`lytex-ops:${k}`);
    } catch {
      return null;
    }
  };

  // View state comes from the route (so "back" restores it), then from the last choice.
  const p = (k: string) => params[k] ?? '';
  // svelte-ignore state_referenced_locally
  let preset = $state<TicketPreset>(
    (p('preset') as TicketPreset) || (projectId ? 'everything' : 'all'),
  );
  let view = $state<'list' | 'kanban'>(
    (p('view') as 'list' | 'kanban') ||
      ((remember('ticketView') as 'list' | 'kanban' | null) ?? 'list'),
  );
  let text = $state(p('text'));
  let project = $state(p('project'));
  let priority = $state(p('priority'));
  let category = $state(p('category'));
  let selected = $state<string[]>([]);
  let bulkTarget = $state('');
  let dragId = $state<string | null>(null);
  let dragOver = $state<string | null>(null);
  /** Drop indicator: card id the dragged card will be placed before, or `end:<status>`. */
  let dropBefore = $state<string | null>(null);

  $effect(() => {
    const state = { preset, view, text, project, priority, category };
    if (projectId) api.router.patchParams({ tab: 'tickets', ...prefixed(state) });
    else api.router.patchParams(state);
  });
  function prefixed(s: Record<string, string>): Record<string, string> {
    return Object.fromEntries(Object.entries(s).map(([k, v]) => [`t_${k}`, v]));
  }

  const settings = $derived(dep($version, () => api.settings()));
  const today = $derived(localDate($now));
  const projects = $derived(
    dep($version, () =>
      api.ctx.index
        .all('project')
        .filter((x) => !x.archived)
        .sort((a, b) => a.name.localeCompare(b.name)),
    ),
  );
  const tickets = $derived.by(() => {
    void $version;
    return filterTickets(
      api.ctx.index,
      settings.workflow,
      {
        preset: view === 'kanban' && preset === 'all' ? 'everything' : preset,
        projectId: projectId ?? (project || null),
        priority: priority || null,
        category: category || null,
        text,
      },
      today,
      settings.me,
      settings.dueSoonDays,
    );
  });
  const tracked = $derived(dep($version, () => trackedSecondsByTicket(api.ctx.index)));
  const projectName = (id: string) => api.ctx.index.get('project', id)?.name ?? '';
  const columns = $derived(
    settings.workflow.filter(
      (s) => s.category !== 'cancelled' || tickets.some((tk) => tk.status === s.key),
    ),
  );

  function setView(v: 'list' | 'kanban') {
    view = v;
    remember('ticketView', v);
  }

  function toggle(id: string) {
    selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
  }

  async function applyBulk() {
    if (!bulkTarget || !selected.length) return;
    const ids = [...selected];
    const r =
      bulkTarget === '__archive'
        ? await bulkArchive(api.ctx, ids)
        : await bulkStatus(api.ctx, ids, bulkTarget);
    api.notify(
      `${r.ok.length} ✓${r.failed.length ? ` · ${r.failed.length} ✕: ${r.failed.map((f) => f.error).join('; ')}` : ''}`,
      r.failed.length ? 'error' : 'success',
    );
    selected = [];
    bulkTarget = '';
  }

  async function withDod(tk: Ticket, status: string, fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (e) {
      if (e instanceof DomainError && e.code === 'dod_failed') {
        if (await api.confirm(t('ticket.dodFailed'), e.message, t('ticket.forceDone'))) {
          await api.run(() => changeTicketStatus(api.ctx, tk.id, status, { force: true }));
          await api.run(() => placeTicket(api.ctx, tk.id, status, null));
        }
      } else api.notify((e as Error).message, 'error');
    }
  }

  function setStatus(tk: Ticket, status: string) {
    return withDod(tk, status, () => changeTicketStatus(api.ctx, tk.id, status));
  }

  /** Before which card does the drop land? Upper half of a card → before it, lower half → after. */
  function onCardDragOver(e: DragEvent, column: Ticket[], index: number, status: string) {
    e.preventDefault();
    e.stopPropagation();
    dragOver = status;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const upper = e.clientY < rect.top + rect.height / 2;
    const target = upper ? column[index] : column[index + 1];
    dropBefore = target ? target.id : `end:${status}`;
  }

  function onDrop(status: string, e: DragEvent) {
    e.preventDefault();
    const id = dragId ?? e.dataTransfer?.getData('text/plain');
    const before = dropBefore && !dropBefore.startsWith('end:') ? dropBefore : null;
    dragOver = null;
    dropBefore = null;
    dragId = null;
    const tk = id ? api.ctx.index.get('ticket', id) : undefined;
    if (!tk || before === tk.id) return;
    void withDod(tk, status, () => placeTicket(api.ctx, tk.id, status, before));
  }

  function onCardKey(tk: Ticket, e: KeyboardEvent) {
    const idx = settings.workflow.findIndex((s) => s.key === tk.status);
    if (e.key === 'Enter') api.router.go({ name: 'ticket', id: tk.id });
    else if (e.key === 'ArrowRight' && e.altKey && idx < settings.workflow.length - 1)
      void setStatus(tk, settings.workflow[idx + 1]!.key);
    else if (e.key === 'ArrowLeft' && e.altKey && idx > 0)
      void setStatus(tk, settings.workflow[idx - 1]!.key);
    else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.altKey) {
      e.preventDefault();
      const col = tickets.filter((x) => x.status === tk.status);
      const i = col.findIndex((x) => x.id === tk.id);
      const before = e.key === 'ArrowUp' ? col[i - 1]?.id : col[i + 2]?.id;
      if (e.key === 'ArrowUp' && i === 0) return;
      if (e.key === 'ArrowDown' && i === col.length - 1) return;
      void api.run(() => placeTicket(api.ctx, tk.id, tk.status, before ?? null));
    }
  }
</script>

<div class="lx-page">
  <div class="lx-toolbar">
    {#if !projectId}<h2>{t('nav.tickets')}</h2>{/if}
    <div class="lx-segmented" role="tablist" aria-label={t('common.filter')}>
      {#each PRESETS as [k, l] (k)}
        <button
          type="button"
          role="tab"
          aria-selected={preset === k}
          class:is-active={preset === k}
          onclick={() => (preset = k)}>{l}</button
        >
      {/each}
    </div>
    <span class="lx-spacer"></span>
    <div class="lx-segmented" role="group">
      <button type="button" class:is-active={view === 'list'} onclick={() => setView('list')}
        >{t('ticket.view.list')}</button
      >
      <button type="button" class:is-active={view === 'kanban'} onclick={() => setView('kanban')}
        >{t('ticket.view.kanban')}</button
      >
    </div>
  </div>
  <div class="lx-toolbar">
    {#if !projectId}
      <select bind:value={project} aria-label={t('ticket.project')}>
        <option value="">{t('ticket.project')}: {t('common.all')}</option>
        {#each projects as pr (pr.id)}<option value={pr.id}>{pr.name}</option>{/each}
      </select>
    {/if}
    <select bind:value={priority} aria-label={t('ticket.priority')}>
      <option value="">{t('ticket.priority')}: {t('common.all')}</option>
      {#each PRIORITIES as pr (pr)}<option value={pr}>{label('priority', pr)}</option>{/each}
    </select>
    <select bind:value={category} aria-label={t('ticket.category')}>
      <option value="">{t('ticket.category')}: {t('common.all')}</option>
      {#each settings.ticketCategories as c (c)}<option value={c}>{c}</option>{/each}
    </select>
    <input
      type="search"
      placeholder={t('common.search')}
      bind:value={text}
      aria-label={t('common.search')}
    />
    <span class="lx-spacer"></span>
    <button
      type="button"
      class="mod-cta"
      onclick={() =>
        api.openForm({
          kind: 'ticket',
          preset: { project_id: projectId ?? (project || undefined) },
        })}>{t('ticket.new')}</button
    >
  </div>

  {#if selected.length}
    <div class="lx-bulkbar">
      <span>{t('common.selected', { n: selected.length })}</span>
      <select bind:value={bulkTarget} aria-label={t('ticket.bulk.status')}>
        <option value="">{t('ticket.bulk.status')}</option>
        {#each settings.workflow as s (s.key)}<option value={s.key}>{s.label}</option>{/each}
        <option value="__archive">{t('ticket.bulk.archive')}</option>
      </select>
      <button type="button" class="mod-cta" disabled={!bulkTarget} onclick={applyBulk}
        >{t('common.confirm')}</button
      >
      <button type="button" onclick={() => (selected = [])}>{t('common.cancel')}</button>
    </div>
  {/if}

  {#if preset === 'mine' && !settings.me}
    <Empty text={t('ticket.mineNoMe')}>
      <button type="button" class="mod-cta" onclick={() => api.router.go({ name: 'settings' })}
        >{t('nav.toSettings')}</button
      >
    </Empty>
  {:else if tickets.length === 0}
    <Empty text={t('ticket.empty')} />
  {:else if view === 'list'}
    <table class="lx-table">
      <thead>
        <tr>
          <th
            ><input
              type="checkbox"
              checked={selected.length === tickets.length}
              onchange={() =>
                (selected = selected.length === tickets.length ? [] : tickets.map((x) => x.id))}
              aria-label={t('common.select')}
            /></th
          >
          <th>#</th>
          <th>{t('ticket.title')}</th>
          {#if !projectId}<th>{t('ticket.project')}</th>{/if}
          <th>{t('common.status')}</th>
          <th>{t('ticket.priority')}</th>
          <th>{t('ticket.assignees')}</th>
          <th>{t('ticket.due')}</th>
          <th class="lx-num">{t('ticket.tracked')} / {t('ticket.estimate')}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {#each tickets as tk (tk.id)}
          <tr class:is-archived={tk.archived}>
            <td
              ><input
                type="checkbox"
                checked={selected.includes(tk.id)}
                onchange={() => toggle(tk.id)}
                aria-label={t('common.select')}
              /></td
            >
            <td class="lx-mono">{tk.ticket_number}</td>
            <td
              ><button
                type="button"
                class="lx-link"
                onclick={() => api.router.go({ name: 'ticket', id: tk.id })}>{tk.title}</button
              >{#if tk.parent_id}<span class="lx-muted"> ↳</span>{/if}</td
            >
            {#if !projectId}<td class="lx-muted">{projectName(tk.project_id)}</td>{/if}
            <td>
              <select
                class="lx-inline-select"
                value={tk.status}
                onchange={(e) => setStatus(tk, (e.currentTarget as HTMLSelectElement).value)}
                aria-label={t('common.status')}
              >
                {#each settings.workflow as s (s.key)}<option value={s.key}>{s.label}</option
                  >{/each}
              </select>
            </td>
            <td><StatusBadge prefix="priority" value={tk.priority} /></td>
            <td class="lx-muted lx-small">{tk.assignees.join(', ') || '—'}</td>
            <td class:lx-danger={isOverdue(tk, settings.workflow, today)}>{date(tk.due_date)}</td>
            <td class="lx-num lx-mono"
              >{dur(tracked.get(tk.id) ?? 0)} / {dur(tk.estimated_seconds)}</td
            >
            <td class="lx-row-actions">
              <button
                type="button"
                class="lx-icon-btn"
                title={t('ticket.startTimer')}
                aria-label={t('ticket.startTimer')}
                onclick={() =>
                  api.startTimer({
                    project_id: tk.project_id,
                    ticket_id: tk.id,
                    billable: tk.billable,
                  })}>▶</button
              >
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {:else}
    <div class="lx-kanban">
      {#each columns as col (col.key)}
        {@const items = tickets.filter((tk) => tk.status === col.key)}
        <div
          class="lx-kanban-col lx-cat-{col.category}"
          class:is-dragover={dragOver === col.key}
          role="list"
          aria-label={col.label}
          ondragover={(e) => {
            e.preventDefault();
            dragOver = col.key;
            if (!items.length || (e.target as HTMLElement) === e.currentTarget)
              dropBefore = `end:${col.key}`;
          }}
          ondragleave={(e) => {
            if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
              if (dragOver === col.key) dragOver = null;
            }
          }}
          ondrop={(e) => onDrop(col.key, e)}
        >
          <header><span>{col.label}</span><span class="lx-muted">{items.length}</span></header>
          {#each items as tk, i (tk.id)}
            <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
            <div
              class="lx-kcard lx-prio-{tk.priority}"
              class:is-dragging={dragId === tk.id}
              class:drop-before={dropBefore === tk.id && dragId !== tk.id}
              role="listitem"
              tabindex="0"
              draggable="true"
              ondragstart={(e) => {
                dragId = tk.id;
                e.dataTransfer?.setData('text/plain', tk.id);
              }}
              ondragend={() => {
                dragId = null;
                dragOver = null;
                dropBefore = null;
              }}
              ondragover={(e) => onCardDragOver(e, items, i, col.key)}
              ondblclick={() => api.router.go({ name: 'ticket', id: tk.id })}
              onkeydown={(e) => onCardKey(tk, e)}
              title={msg(
                'Enter: öffnen · Alt+←/→: Status · Alt+↑/↓: Reihenfolge',
                'Enter: open · Alt+←/→: status · Alt+↑/↓: order',
              )}
            >
              <div class="lx-kcard-top">
                <button
                  type="button"
                  class="lx-link"
                  onclick={() => api.router.go({ name: 'ticket', id: tk.id })}
                  >{tk.ticket_number}</button
                >
                <button
                  type="button"
                  class="lx-icon-btn"
                  aria-label={t('ticket.startTimer')}
                  title={t('ticket.startTimer')}
                  onclick={() =>
                    api.startTimer({
                      project_id: tk.project_id,
                      ticket_id: tk.id,
                      billable: tk.billable,
                    })}>▶</button
                >
              </div>
              <div class="lx-kcard-title">{tk.title}</div>
              <div class="lx-kcard-meta">
                {#if !projectId}<span>{projectName(tk.project_id)}</span>{/if}
                {#if tk.due_date}<span class:lx-danger={isOverdue(tk, settings.workflow, today)}
                    >{date(tk.due_date)}</span
                  >{/if}
                {#if tk.checklist.length}<span
                    >☑ {tk.checklist.filter((c) => c.done).length}/{tk.checklist.length}</span
                  >{/if}
                {#if tk.estimated_seconds}<span
                    >{dur(tracked.get(tk.id) ?? 0)}/{dur(tk.estimated_seconds)}</span
                  >{/if}
                {#if tk.assignees.length}<span title={tk.assignees.join(', ')}
                    >👤 {tk.assignees.map((a) => a.split(' ')[0]).join(', ')}</span
                  >{/if}
              </div>
            </div>
          {/each}
          <div class="lx-kanban-end" class:drop-before={dropBefore === `end:${col.key}`}></div>
        </div>
      {/each}
    </div>
    <p class="lx-muted lx-small">{t('ticket.reorderHint')}</p>
  {/if}
</div>
