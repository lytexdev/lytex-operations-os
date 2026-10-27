<script lang="ts">
  import { msg } from '@/shared/i18n';
  import { confirmDelete } from '../components/delete';
  import type { UiApi } from '../stores/ui-api';
  import { t } from '@/shared/i18n';
  import { createManualEntry, editEntry, overlapsFor, rateFor } from '@/application/use-cases/time';
  import { DomainError } from '@/domain/errors/errors';
  import {
    FormErrors,
    dateTimeField,
    durationField,
    moneyField,
    centsToInput,
    secondsToInput,
  } from './form-utils';
  import { localDate, formatLocalTime, parseIso } from '@/shared/date/time';
  import { money, dateTime } from '../components/labels';
  import Field from '../components/Field.svelte';

  let {
    api,
    id,
    preset = {},
    close,
  }: { api: UiApi; id?: string; preset?: Record<string, unknown>; close: () => void } = $props();
  // svelte-ignore state_referenced_locally
  const ex = id ? api.ctx.repo.find('time_entry', id) : undefined;
  const nowMs = Date.now();
  // svelte-ignore state_referenced_locally
  let f = $state({
    project: ex?.project_id ?? String(preset['project_id'] ?? ''),
    ticket: ex?.ticket_id ?? String(preset['ticket_id'] ?? ''),
    date: ex ? localDate(parseIso(ex.started_at)) : localDate(nowMs),
    start: ex ? formatLocalTime(parseIso(ex.started_at)) : formatLocalTime(nowMs - 3600_000),
    end: ex ? formatLocalTime(parseIso(ex.ended_at)) : formatLocalTime(nowMs),
    duration: ex && ex.segments.length === 0 ? secondsToInput(ex.duration_seconds) : '',
    description: ex?.description ?? '',
    billable: ex?.billable ?? true,
    rate: ex && ex.rate_source === 'manual' ? centsToInput(ex.rate_cents) : '',
    reason: '',
  });
  let errors = $state<Record<string, string>>({});
  let overlapWarning = $state<string | null>(null);
  const projects = api.ctx.index
    .all('project')
    .filter((p) => !p.archived || p.id === f.project)
    .sort((a, b) => a.name.localeCompare(b.name));
  const tickets = $derived(
    api.ctx.index
      .all('ticket')
      .filter((x) => x.project_id === f.project && (!x.archived || x.id === f.ticket)),
  );
  const rateInfo = $derived.by(() => {
    if (!f.project) return null;
    try {
      return rateFor(api.ctx, f.project, f.ticket || null);
    } catch {
      return null;
    }
  });
  $effect(() => {
    if (!ex && rateInfo) f.billable = rateInfo.billableDefault;
  });

  async function submit(e: Event, acknowledged = false) {
    e.preventDefault();
    const v = new FormErrors();
    v.require('project', f.project, msg('Projekt ist erforderlich', 'Project is required'));
    const start = v.take('start', dateTimeField(f.date, f.start));
    let end = v.take('end', dateTimeField(f.date, f.end));
    if (start !== undefined && end !== undefined && end <= start) end += 86400_000; // over midnight
    const duration = v.take('duration', durationField(f.duration));
    const rate = v.take('rate', moneyField(f.rate, { min: 0 }));
    errors = v.errors;
    if (!v.ok) return;
    if (!acknowledged) {
      const hits = overlapsFor(api.ctx, [{ start, end }], ex?.id);
      if (hits.length) {
        overlapWarning = `${t('time.overlap', { n: hits.length })}\n${hits
          .slice(0, 3)
          .map((h) => `${dateTime(h.started_at)} – ${h.description || h.id}`)
          .join('\n')}`;
        return;
      }
    }
    try {
      if (ex) {
        await editEntry(
          api.ctx,
          ex.id,
          {
            project_id: f.project,
            ticket_id: f.ticket || null,
            description: f.description,
            start,
            end,
            duration_seconds: duration ?? undefined,
            billable: f.billable,
            rate_cents: rate ?? undefined,
            overlap_acknowledged: acknowledged,
            reason: f.reason,
          },
          ex.updated_at,
        );
      } else {
        await createManualEntry(api.ctx, {
          project_id: f.project,
          ticket_id: f.ticket || null,
          description: f.description,
          start,
          end,
          duration_seconds: duration ?? undefined,
          billable: f.billable,
          rate_cents: rate,
          overlap_acknowledged: acknowledged,
        });
      }
      api.notify(t('common.saved'), 'success');
      close();
    } catch (err) {
      if (err instanceof DomainError && err.code === 'overlap') overlapWarning = err.message;
      else api.notify((err as Error).message, 'error');
    }
  }
</script>

<form class="lx-form" onsubmit={(e) => submit(e)} novalidate>
  <div class="lx-form-grid">
    <Field label={t('ticket.project')} error={errors['project']} required>
      <select bind:value={f.project} onchange={() => (f.ticket = '')}
        ><option value="">—</option>{#each projects as p (p.id)}<option value={p.id}
            >{p.name}</option
          >{/each}</select
      >
    </Field>
    <Field label={t('timer.ticket')}
      ><select bind:value={f.ticket}
        ><option value="">—</option>{#each tickets as x (x.id)}<option value={x.id}
            >{x.ticket_number} {x.title}</option
          >{/each}</select
      ></Field
    >
    <Field label={t('time.date')} error={errors['start'] && !f.start ? errors['start'] : ''}
      ><input type="date" bind:value={f.date} /></Field
    >
    <Field label={t('time.start')} error={errors['start']}
      ><input type="time" bind:value={f.start} /></Field
    >
    <Field
      label={t('time.end')}
      error={errors['end']}
      hint={msg('Ende vor Beginn = über Mitternacht', 'End before start = past midnight')}
      ><input type="time" bind:value={f.end} /></Field
    >
    <Field
      label={t('time.duration')}
      error={errors['duration']}
      hint={msg('Nur wenn Pausen im Zeitraum lagen', 'Only if there were breaks in the time range')}
      ><input type="text" bind:value={f.duration} /></Field
    >
    <Field label={t('common.description')} wide
      ><input type="text" bind:value={f.description} /></Field
    >
    <label class="lx-check"
      ><input
        type="checkbox"
        bind:checked={f.billable}
        disabled={rateInfo?.project.billing_model === 'internal'}
      />
      {t('ticket.billable')}</label
    >
    <Field
      label={t('time.rate')}
      error={errors['rate']}
      hint={rateInfo
        ? msg(
            `Automatisch: ${money(rateInfo.rate_cents)} (${rateInfo.source})`,
            `Automatic: ${money(rateInfo.rate_cents)} (${rateInfo.source})`,
          )
        : ''}><input type="text" inputmode="decimal" bind:value={f.rate} /></Field
    >
    {#if ex}<Field label={t('time.reason')} wide><input type="text" bind:value={f.reason} /></Field
      >{/if}
  </div>
  {#if overlapWarning}
    <div class="lx-callout lx-tone-warn" role="alert">
      {#each overlapWarning.split('\n') as line, i (i)}<div>{line}</div>{/each}
      {#if api.settings().overlapPolicy === 'warn'}<button
          type="button"
          class="mod-warning"
          onclick={(e) => submit(e, true)}>{t('common.confirm')}</button
        >{/if}
    </div>
  {/if}
  {#if ex && ex.history.length}
    <details>
      <summary>{t('time.history')}</summary>
      <ul class="lx-list lx-small">
        {#each [...ex.history].reverse() as h, i (i)}<li>
            {dateTime(h.at)} · {h.action}: {h.detail}
          </li>{/each}
      </ul>
    </details>
  {/if}
  <div class="lx-modal-actions">
    {#if ex}<button
        type="button"
        class="mod-warning lx-actions-left"
        onclick={async () => {
          if (await confirmDelete(api, 'time_entry', ex.id, ex.description || t('nav.time')))
            close();
        }}>{t('common.delete')}</button
      >{/if}
    <button type="button" onclick={close}>{t('common.cancel')}</button>
    <button type="submit" class="mod-cta">{ex ? t('common.save') : t('common.create')}</button>
  </div>
</form>
