<script lang="ts">
  import { msg } from '@/shared/i18n';
  import { dep } from '../components/labels';
  import type { UiApi } from '../stores/ui-api';
  import { t } from '@/shared/i18n';
  import { describeRecurrence, nextOccurrence } from '@/domain/services/recurrence';
  import { reconcileRecurring } from '@/application/use-cases/recurring';
  import { localDate } from '@/shared/date/time';
  import { dur, date, label } from '../components/labels';
  import Empty from '../components/Empty.svelte';

  let { api }: { api: UiApi } = $props();
  const version = api.version;
  const tasks = $derived(
    dep($version, () =>
      api.ctx.index
        .all('recurring_task')
        .filter((r) => !r.archived)
        .sort((a, b) => a.title.localeCompare(b.title)),
    ),
  );
  const today = localDate(Date.now());

  async function reconcile() {
    const r = await api.run(() => reconcileRecurring(api.ctx));
    if (r)
      api.notify(
        t('recurring.reconciled', { n: r.created.length }) +
          (r.errors.length
            ? msg(
                ` · ${r.errors.length} Fehler: ${r.errors[0]!.error}`,
                ` · ${r.errors.length} errors: ${r.errors[0]!.error}`,
              )
            : ''),
        r.errors.length ? 'error' : 'success',
      );
  }
</script>

<div class="lx-page">
  <div class="lx-toolbar">
    <h2>{t('nav.recurring')}</h2>
    <span class="lx-spacer"></span>
    <button type="button" onclick={reconcile}>{t('recurring.reconcile')}</button>
    <button type="button" class="mod-cta" onclick={() => api.openForm({ kind: 'recurring' })}
      >{t('recurring.new')}</button
    >
  </div>
  {#if tasks.length === 0}
    <Empty text={t('recurring.empty')} />
  {:else}
    <table class="lx-table">
      <thead
        ><tr
          ><th>{t('ticket.title')}</th><th>{t('ticket.project')}</th><th>{t('recurring.freq')}</th
          ><th>{t('recurring.next')}</th><th class="lx-num">{t('ticket.estimate')}</th><th
            >{t('recurring.active')}</th
          ><th></th></tr
        ></thead
      >
      <tbody>
        {#each tasks as r (r.id)}
          <tr class:is-archived={!r.active}>
            <td
              ><button
                type="button"
                class="lx-link"
                onclick={() => api.openForm({ kind: 'recurring', id: r.id })}>{r.title}</button
              ></td
            >
            <td
              ><button
                type="button"
                class="lx-link"
                onclick={() => api.router.go({ name: 'project', id: r.project_id })}
                >{api.ctx.index.get('project', r.project_id)?.name}</button
              ></td
            >
            <td>{describeRecurrence(r.recurrence)}</td>
            <td>{date(nextOccurrence(r, today))}</td>
            <td class="lx-num">{dur(r.estimated_seconds)}</td>
            <td>{r.active ? t('common.yes') : t('common.no')} · {label('priority', r.priority)}</td>
            <td class="lx-row-actions"
              ><button
                type="button"
                class="lx-icon-btn"
                aria-label={t('common.openNote')}
                onclick={() => api.openNote(r.id)}>↗</button
              ></td
            >
          </tr>
        {/each}
      </tbody>
    </table>
    <p class="lx-muted lx-small">
      {msg(
        'Tickets werden beim Start von Obsidian und täglich abgeglichen. Verpasste Termine werden       nachgeholt, jeder Termin erzeugt höchstens ein Ticket.',
        'Tickets are reconciled when Obsidian starts and daily. Missed dates are caught up; each date creates at most one ticket.',
      )}
    </p>
  {/if}
</div>
