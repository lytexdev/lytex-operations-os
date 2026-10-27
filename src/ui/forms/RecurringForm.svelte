<script lang="ts">
  import { msg } from '@/shared/i18n';
  import { confirmDelete } from '../components/delete';
  import type { UiApi } from '../stores/ui-api';
  import { t } from '@/shared/i18n';
  import { PRIORITIES } from '@/domain/schemas/common';
  import type { Recurrence } from '@/domain/schemas/entities';
  import { createRecurringTask } from '@/application/use-cases/recurring';
  import { occurrencesBetween } from '@/domain/services/recurrence';
  import { FormErrors, dateField, unitDurationField, secondsToUnitInput } from './form-utils';
  import DurationInput from '../components/DurationInput.svelte';
  import { localDate, addDays } from '@/shared/date/time';
  import { date } from '../components/labels';
  import Field from '../components/Field.svelte';

  let {
    api,
    id,
    close,
  }: { api: UiApi; id?: string; preset?: Record<string, unknown>; close: () => void } = $props();
  // svelte-ignore state_referenced_locally
  const ex = id ? api.ctx.repo.find('recurring_task', id) : undefined;
  const today = localDate(Date.now());
  // svelte-ignore state_referenced_locally
  let f = $state({
    title: ex?.title ?? '',
    project: ex?.project_id ?? '',
    service: ex?.service_id ?? '',
    freq: ex?.recurrence.freq ?? ('monthly' as Recurrence['freq']),
    interval: String(ex?.recurrence.interval ?? 1),
    weekdays: ex?.recurrence.weekdays ?? [1],
    dom: ex?.recurrence.day_of_month ? String(ex.recurrence.day_of_month) : '',
    start: ex?.start_date ?? today,
    end: ex?.end_date ?? '',
    lead: String(ex?.lead_days ?? api.settings().recurringLeadDays),
    estimate: secondsToUnitInput(ex?.estimated_seconds).text,
    estimateUnit: secondsToUnitInput(ex?.estimated_seconds).unit,
    priority: ex?.priority ?? 'normal',
    billable: ex?.billable ?? true,
    active: ex?.active ?? true,
    category: ex?.category ?? msg('Wartung', 'Maintenance'),
    checklist: ex?.checklist.join('\n') ?? '',
  });
  let errors = $state<Record<string, string>>({});
  const projects = api.ctx.index
    .all('project')
    .filter((p) => !p.archived)
    .sort((a, b) => a.name.localeCompare(b.name));
  const services = api.ctx.index.all('service').filter((x) => !x.archived);
  const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

  function recurrence(): Recurrence {
    return {
      freq: f.freq,
      interval: Math.max(1, Number(f.interval) || 1),
      weekdays: f.freq === 'weekly' ? [...f.weekdays].sort() : [],
      day_of_month: f.freq === 'monthly' && f.dom ? Number(f.dom) : null,
    };
  }
  const previewDates = $derived.by(() => {
    try {
      return occurrencesBetween(
        recurrence(),
        f.start,
        today,
        addDays(today, 120),
        f.end || null,
      ).slice(0, 5);
    } catch {
      return [];
    }
  });

  async function submit(e: Event) {
    e.preventDefault();
    const v = new FormErrors();
    const title = v.require('title', f.title, msg('Titel ist erforderlich', 'Title is required'));
    v.require('project', f.project, msg('Projekt ist erforderlich', 'Project is required'));
    const start = v.take('start', dateField(f.start, true));
    const end = v.take('end', dateField(f.end));
    const est = v.take('estimate', unitDurationField(f.estimate, f.estimateUnit));
    const dom = f.dom ? Number(f.dom) : null;
    if (dom !== null && (!Number.isInteger(dom) || dom < 1 || dom > 31)) v.errors['dom'] = '1–31';
    if (f.freq === 'weekly' && !f.weekdays.length)
      v.errors['weekdays'] = msg('Mindestens ein Wochentag', 'At least one weekday');
    errors = v.errors;
    if (!v.ok) return;
    const data = {
      title,
      project_id: f.project,
      service_id: f.service || null,
      recurrence: recurrence(),
      start_date: start!,
      end_date: end,
      lead_days: Math.max(0, Number(f.lead) || 0),
      estimated_seconds: est,
      priority: f.priority,
      billable: f.billable,
      active: f.active,
      category: f.category,
      checklist: f.checklist
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    };
    const r = ex
      ? await api.run(
          () =>
            api.ctx.repo.update(
              'recurring_task',
              ex.id,
              (d) => ({
                ...d,
                ...data,
                generated_through: d.start_date === data.start_date ? d.generated_through : null,
              }),
              { expectedUpdatedAt: ex.updated_at },
            ),
          t('common.saved'),
        )
      : await api.run(
          () => createRecurringTask(api.ctx, { ...data, customer_id: null }),
          t('common.saved'),
        );
    if (r) close();
  }
</script>

<form class="lx-form" onsubmit={submit} novalidate>
  <div class="lx-form-grid">
    <Field label={t('ticket.title')} error={errors['title']} required wide
      ><input
        type="text"
        bind:value={f.title}
        placeholder={msg('z. B. Monatliche Server-Wartung', 'e.g. Monthly server maintenance')}
      /></Field
    >
    <Field label={t('ticket.project')} error={errors['project']} required
      ><select bind:value={f.project}
        ><option value="">—</option>{#each projects as p (p.id)}<option value={p.id}
            >{p.name}</option
          >{/each}</select
      ></Field
    >
    <Field label={t('project.service')}
      ><select bind:value={f.service}
        ><option value="">—</option>{#each services as x (x.id)}<option value={x.id}
            >{x.name}</option
          >{/each}</select
      ></Field
    >
    <Field label={t('recurring.freq')}>
      <select bind:value={f.freq}
        >{#each ['daily', 'weekly', 'monthly', 'interval_days'] as q (q)}<option value={q}
            >{t(`recurring.freq.${q}` as never)}</option
          >{/each}</select
      >
    </Field>
    <Field label={t('recurring.interval')}
      ><input type="number" min="1" max="366" bind:value={f.interval} /></Field
    >
    {#if f.freq === 'weekly'}
      <fieldset class="lx-fieldset lx-field-wide">
        <legend class="lx-field-label">{t('recurring.weekdays')}</legend>
        <div class="lx-radio-row">
          {#each WD as w, i (i)}<label class="lx-check"
              ><input
                type="checkbox"
                checked={f.weekdays.includes(i + 1)}
                onchange={() =>
                  (f.weekdays = f.weekdays.includes(i + 1)
                    ? f.weekdays.filter((x) => x !== i + 1)
                    : [...f.weekdays, i + 1])}
              />
              {w}</label
            >{/each}
        </div>
        {#if errors['weekdays']}<span class="lx-field-error" role="alert">{errors['weekdays']}</span
          >{/if}
      </fieldset>
    {/if}
    {#if f.freq === 'monthly'}<Field
        label={t('recurring.dayOfMonth')}
        error={errors['dom']}
        hint={msg(
          'Leer = Tag des Startdatums; 31 = Monatsletzter',
          'Empty = day of the start date; 31 = last day of month',
        )}><input type="number" min="1" max="31" bind:value={f.dom} /></Field
      >{/if}
    <Field label={t('recurring.start')} error={errors['start']} required
      ><input type="date" bind:value={f.start} /></Field
    >
    <Field label={t('recurring.end')} error={errors['end']}
      ><input type="date" bind:value={f.end} /></Field
    >
    <Field label={t('recurring.lead')}
      ><input type="number" min="0" max="90" bind:value={f.lead} /></Field
    >
    <Field label={t('ticket.estimate')} error={errors['estimate']}
      ><DurationInput
        bind:text={f.estimate}
        bind:unit={f.estimateUnit}
        label={t('ticket.estimate')}
      /></Field
    >
    <Field label={t('ticket.priority')}
      ><select bind:value={f.priority}
        >{#each PRIORITIES as p (p)}<option value={p}>{t(`priority.${p}` as never)}</option
          >{/each}</select
      ></Field
    >
    <Field label={t('ticket.category')}><input type="text" bind:value={f.category} /></Field>
    <label class="lx-check"
      ><input type="checkbox" bind:checked={f.billable} /> {t('ticket.billable')}</label
    >
    <label class="lx-check"
      ><input type="checkbox" bind:checked={f.active} /> {t('recurring.active')}</label
    >
    <Field label={t('recurring.checklist')} wide
      ><textarea rows="3" bind:value={f.checklist}></textarea></Field
    >
  </div>
  <p class="lx-small lx-muted">
    {msg('Nächste Termine', 'Next dates')}: {previewDates.map((d) => date(d)).join(', ') || '—'}
  </p>
  <div class="lx-modal-actions">
    {#if ex}<button
        type="button"
        class="mod-warning lx-actions-left"
        onclick={async () => {
          if (await confirmDelete(api, 'recurring_task', ex.id, ex.title)) close();
        }}>{t('common.delete')}</button
      >{/if}
    {#if ex}<button
        type="button"
        onclick={async () => {
          await api.run(() => api.ctx.repo.archive('recurring_task', ex.id));
          close();
        }}>{t('common.archive')}</button
      >{/if}
    <button type="button" onclick={close}>{t('common.cancel')}</button>
    <button type="submit" class="mod-cta">{ex ? t('common.save') : t('common.create')}</button>
  </div>
</form>
