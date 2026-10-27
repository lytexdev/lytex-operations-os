<script lang="ts">
  import { msg } from '@/shared/i18n';
  import { confirmDelete } from '../components/delete';
  import { dep } from '../components/labels';
  import type { UiApi } from '../stores/ui-api';
  import { t } from '@/shared/i18n';
  import { trackedSecondsByTicket, entriesByProject } from '@/application/queries/aggregates';
  import {
    changeTicketStatus,
    addChecklistItem,
    toggleChecklistItem,
    removeChecklistItem,
    addComment,
    setDependencies,
    doneProblems,
    readTicketBody,
    updateTicketBody,
  } from '@/application/use-cases/tickets';
  import MarkdownEditor from '../components/MarkdownEditor.svelte';
  import { markdown } from '../components/markdown';
  import { DomainError } from '@/domain/errors/errors';
  import { isClosed } from '@/domain/policies/workflow';
  import { dur, date, dateTime, label } from '../components/labels';
  import Section from '../components/Section.svelte';
  import Stat from '../components/Stat.svelte';
  import StatusBadge from '../components/StatusBadge.svelte';
  import Empty from '../components/Empty.svelte';
  import EntryTable from './EntryTable.svelte';

  let { api, id }: { api: UiApi; id: string } = $props();
  const version = api.version;
  let newItem = $state('');
  let newItemRequired = $state(false);
  let comment = $state('');
  let depToAdd = $state('');

  const tk = $derived(dep($version, () => api.ctx.index.get('ticket', id)));
  const settings = $derived(dep($version, () => api.settings()));
  const data = $derived.by(() => {
    void $version;
    if (!tk) return null;
    const idx = api.ctx.index;
    return {
      project: idx.get('project', tk.project_id),
      customer: idx.get('customer', tk.customer_id),
      parent: idx.get('ticket', tk.parent_id),
      children: idx.all('ticket').filter((x) => x.parent_id === id && !x.archived),
      deps: tk.depends_on.map((d) => idx.get('ticket', d)).filter((x) => !!x),
      siblings: idx
        .all('ticket')
        .filter(
          (x) =>
            x.project_id === tk.project_id &&
            x.id !== id &&
            !tk.depends_on.includes(x.id) &&
            !x.archived,
        ),
      tracked: trackedSecondsByTicket(idx).get(id) ?? 0,
      entries: (entriesByProject(idx).get(tk.project_id) ?? [])
        .filter((e) => e.ticket_id === id)
        .sort((a, b) => b.started_at.localeCompare(a.started_at)),
      problems: doneProblems(api.ctx, tk),
    };
  });

  // Markdown body (description & notes), read from the note file.
  let body = $state<string | null>(null);
  let editingBody = $state(false);
  let draftBody = $state('');
  const notePath = $derived(dep($version, () => api.ctx.index.pathOf(id) ?? ''));
  $effect(() => {
    void $version;
    if (editingBody) return;
    void readTicketBody(api.ctx, id).then(
      (b) => (body = b),
      () => (body = ''),
    );
  });
  /** Hide the generated H1 title line (shown in the header already). */
  function displayBody(b: string): string {
    return b.replace(/^\s*# .*\n/, '').trim();
  }
  async function saveBody() {
    const ok = await api.run(
      async () => (await updateTicketBody(api.ctx, id, draftBody), true),
      t('common.saved'),
    );
    if (ok) {
      body = draftBody;
      editingBody = false;
    }
  }

  async function setStatus(status: string) {
    try {
      await changeTicketStatus(api.ctx, id, status);
    } catch (e) {
      if (e instanceof DomainError && e.code === 'dod_failed') {
        if (await api.confirm(t('ticket.dodFailed'), e.message, t('ticket.forceDone')))
          await api.run(() => changeTicketStatus(api.ctx, id, status, { force: true }));
      } else api.notify((e as Error).message, 'error');
    }
  }
</script>

{#if !tk || !data}
  <Empty text={msg('Ticket nicht gefunden.', 'Ticket not found.')} />
{:else}
  <div class="lx-page">
    <div class="lx-detail-head">
      <div>
        <h2><span class="lx-mono lx-muted">{tk.ticket_number}</span> {tk.title}</h2>
        <div class="lx-muted">
          <button
            type="button"
            class="lx-link"
            onclick={() => api.router.go({ name: 'project', id: tk.project_id })}
            >{data.project?.name}</button
          >
          {#if data.customer}
            · <button
              type="button"
              class="lx-link"
              onclick={() => api.router.go({ name: 'customer', id: data.customer!.id })}
              >{data.customer.name}</button
            >{/if}
          {#if data.parent}
            · ↳ <button
              type="button"
              class="lx-link"
              onclick={() => api.router.go({ name: 'ticket', id: data.parent!.id })}
              >{data.parent.ticket_number}</button
            >{/if}
        </div>
      </div>
      <div class="lx-actions">
        <select
          value={tk.status}
          onchange={(e) => setStatus((e.currentTarget as HTMLSelectElement).value)}
          aria-label={t('common.status')}
        >
          {#each settings.workflow as s (s.key)}<option value={s.key}>{s.label}</option>{/each}
        </select>
        <button type="button" onclick={() => api.openForm({ kind: 'ticket', id: tk.id })}
          >{t('common.edit')}</button
        >
        <button type="button" onclick={() => api.openNote(tk.id)}>{t('common.openNote')}</button>
        <button
          type="button"
          onclick={() =>
            api.run(() => api.ctx.repo.archive('ticket', tk.id, !tk.archived), t('common.saved'))}
          >{tk.archived ? t('common.unarchive') : t('common.archive')}</button
        >
        <button
          type="button"
          class="mod-warning"
          onclick={async () => {
            if (await confirmDelete(api, 'ticket', tk.id, `${tk.ticket_number} ${tk.title}`))
              api.router.back();
          }}>{t('common.delete')}</button
        >
        <button
          type="button"
          class="mod-cta"
          onclick={() =>
            api.startTimer({ project_id: tk.project_id, ticket_id: tk.id, billable: tk.billable })}
          >▶ {t('ticket.startTimer')}</button
        >
      </div>
    </div>

    <div class="lx-stats">
      <Stat
        label={t('ticket.tracked')}
        value={dur(data.tracked)}
        hint="{t('ticket.estimate')}: {dur(tk.estimated_seconds)}"
        tone={tk.estimated_seconds && data.tracked > tk.estimated_seconds ? 'warn' : 'default'}
      />
      <Stat
        label={t('ticket.priority')}
        value={label('priority', tk.priority)}
        hint={tk.category}
      />
      <Stat
        label={t('ticket.due')}
        value={date(tk.due_date)}
        hint={tk.completed_at ? `✓ ${dateTime(tk.completed_at)}` : ''}
      />
      <Stat
        label={t('ticket.assignees')}
        value={tk.assignees.join(', ') || '—'}
        hint="{t('ticket.billable')}: {tk.billable ? t('common.yes') : t('common.no')}"
      />
    </div>

    {#if data.problems.length && !isClosed(settings.workflow, tk.status)}
      <div class="lx-callout lx-tone-warn">
        {t('ticket.dodFailed')}: {data.problems.join(' · ')}
      </div>
    {/if}

    <Section title={t('ticket.body')}>
      {#snippet actions()}
        {#if editingBody}
          <button type="button" onclick={() => (editingBody = false)}>{t('common.cancel')}</button>
          <button type="button" class="mod-cta" onclick={saveBody}>{t('common.save')}</button>
        {:else}
          <button
            type="button"
            onclick={() => {
              draftBody = body ?? '';
              editingBody = true;
            }}
            disabled={body === null}>{t('ticket.editBody')}</button
          >
        {/if}
      {/snippet}
      {#if editingBody}
        <MarkdownEditor
          {api}
          bind:value={draftBody}
          projectId={tk.project_id}
          sourcePath={notePath}
          rows={14}
        />
      {:else if body === null}
        <p class="lx-muted">{t('app.loading')}</p>
      {:else}
        <div
          class="lx-md-preview markdown-rendered"
          use:markdown={{ api, text: displayBody(body) || '—', sourcePath: notePath }}
        ></div>
      {/if}
    </Section>

    <div class="lx-grid-2">
      <Section title={t('ticket.checklist')}>
        <ul class="lx-list">
          {#each tk.checklist as c (c.id)}
            <li>
              <label class="lx-check"
                ><input
                  type="checkbox"
                  checked={c.done}
                  onchange={() => api.run(() => toggleChecklistItem(api.ctx, id, c.id))}
                /> <span class:lx-done={c.done}>{c.text}</span>{#if c.required}<span
                    class="lx-badge lx-badge-warn">{t('ticket.requiredItem')}</span
                  >{/if}</label
              >
              <button
                type="button"
                class="lx-icon-btn"
                aria-label={t('common.delete')}
                onclick={() => api.run(() => removeChecklistItem(api.ctx, id, c.id))}>✕</button
              >
            </li>
          {:else}<li class="lx-muted">—</li>{/each}
        </ul>
        <form
          class="lx-inline-form"
          onsubmit={async (e) => {
            e.preventDefault();
            if (await api.run(() => addChecklistItem(api.ctx, id, newItem, newItemRequired))) {
              newItem = '';
              newItemRequired = false;
            }
          }}
        >
          <input
            type="text"
            placeholder={t('ticket.addItem')}
            bind:value={newItem}
            aria-label={t('ticket.addItem')}
          />
          <label class="lx-check"
            ><input type="checkbox" bind:checked={newItemRequired} />
            {t('ticket.requiredItem')}</label
          >
          <button type="submit">+</button>
        </form>
      </Section>
      <Section title={t('ticket.dependsOn')}>
        <ul class="lx-list">
          {#each data.deps as d (d!.id)}
            <li>
              <button
                type="button"
                class="lx-link"
                onclick={() => api.router.go({ name: 'ticket', id: d!.id })}
                >{d!.ticket_number} {d!.title}</button
              >
              <span
                >{isClosed(settings.workflow, d!.status)
                  ? '✓'
                  : settings.workflow.find((s) => s.key === d!.status)?.label}
                <button
                  type="button"
                  class="lx-icon-btn"
                  aria-label={t('common.delete')}
                  onclick={() =>
                    api.run(() =>
                      setDependencies(
                        api.ctx,
                        id,
                        tk.depends_on.filter((x) => x !== d!.id),
                      ),
                    )}>✕</button
                ></span
              >
            </li>
          {:else}<li class="lx-muted">—</li>{/each}
        </ul>
        <form
          class="lx-inline-form"
          onsubmit={async (e) => {
            e.preventDefault();
            if (
              depToAdd &&
              (await api.run(() => setDependencies(api.ctx, id, [...tk.depends_on, depToAdd])))
            )
              depToAdd = '';
          }}
        >
          <select bind:value={depToAdd} aria-label={t('ticket.dependsOn')}>
            <option value="">—</option>
            {#each data.siblings as s (s.id)}<option value={s.id}
                >{s.ticket_number} {s.title}</option
              >{/each}
          </select>
          <button type="submit" disabled={!depToAdd}>+</button>
        </form>
        <h4>{t('ticket.subtasks')}</h4>
        <ul class="lx-list">
          {#each data.children as c (c.id)}
            <li>
              <button
                type="button"
                class="lx-link"
                onclick={() => api.router.go({ name: 'ticket', id: c.id })}
                >{c.ticket_number} {c.title}</button
              ><span class="lx-muted"
                >{settings.workflow.find((s) => s.key === c.status)?.label}</span
              >
            </li>
          {:else}<li class="lx-muted">—</li>{/each}
        </ul>
        <button
          type="button"
          onclick={() =>
            api.openForm({
              kind: 'ticket',
              preset: { project_id: tk.project_id, parent_id: tk.id },
            })}>+ {t('ticket.subtasks')}</button
        >
      </Section>
      <Section title={t('ticket.activity')}>
        <form
          class="lx-inline-form"
          onsubmit={async (e) => {
            e.preventDefault();
            if (await api.run(() => addComment(api.ctx, id, comment))) comment = '';
          }}
        >
          <input
            type="text"
            placeholder={t('ticket.comment')}
            bind:value={comment}
            aria-label={t('ticket.comment')}
          />
          <button type="submit" disabled={!comment.trim()}>+</button>
        </form>
        <ul class="lx-list lx-timeline">
          {#each [...tk.activity].reverse() as a, i (i)}
            <li>
              {#if a.action === 'comment'}
                <div
                  class="lx-comment markdown-rendered"
                  use:markdown={{ api, text: a.detail, sourcePath: notePath }}
                ></div>
              {:else}
                <span
                  >{a.action === 'status'
                    ? `Status: ${a.detail}`
                    : `${a.action}${a.detail ? `: ${a.detail}` : ''}`}</span
                >
              {/if}<span class="lx-muted">{dateTime(a.at)}</span>
            </li>
          {/each}
        </ul>
      </Section>
      <Section title={t('nav.time')}>
        {#snippet actions()}<button
            type="button"
            onclick={() =>
              api.openForm({
                kind: 'time',
                preset: { project_id: tk.project_id, ticket_id: tk.id },
              })}>+</button
          >{/snippet}
        <EntryTable {api} entries={data.entries} />
      </Section>
    </div>
    <p class="lx-muted lx-small">
      {t('common.tags')}: {tk.tags.join(', ') || '—'} · <StatusBadge
        prefix="priority"
        value={tk.priority}
      />
    </p>
  </div>
{/if}
