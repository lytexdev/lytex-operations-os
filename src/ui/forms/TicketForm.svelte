<script lang="ts">
  import { msg } from '@/shared/i18n';
  import type { UiApi } from '../stores/ui-api';
  import { t } from '@/shared/i18n';
  import { PRIORITIES } from '@/domain/schemas/common';
  import {
    createTicket,
    updateTicket,
    builtinTicketTemplates,
  } from '@/application/use-cases/tickets';
  import {
    FormErrors,
    unitDurationField,
    dateField,
    tagsField,
    secondsToUnitInput,
  } from './form-utils';
  import DurationInput from '../components/DurationInput.svelte';
  import AssigneePicker from '../components/AssigneePicker.svelte';
  import MarkdownEditor from '../components/MarkdownEditor.svelte';
  import { ulid } from '@/shared/ids/ulid';
  import Field from '../components/Field.svelte';

  let {
    api,
    id,
    preset = {},
    close,
  }: { api: UiApi; id?: string; preset?: Record<string, unknown>; close: () => void } = $props();
  // svelte-ignore state_referenced_locally
  const ex = id ? api.ctx.repo.find('ticket', id) : undefined;
  const s = api.settings();
  const defaultStatus = s.workflow.find((w) => w.key === 'todo')?.key ?? s.workflow[0]!.key;
  // svelte-ignore state_referenced_locally
  let f = $state({
    project: ex?.project_id ?? String(preset['project_id'] ?? ''),
    title: ex?.title ?? '',
    status: ex?.status ?? defaultStatus,
    priority: ex?.priority ?? 'normal',
    category: ex?.category ?? '',
    due: ex?.due_date ?? '',
    estimate: secondsToUnitInput(ex?.estimated_seconds).text,
    estimateUnit: secondsToUnitInput(ex?.estimated_seconds).unit,
    billable: ex?.billable ?? true,
    assignees: ex ? [...ex.assignees] : s.defaultAssignee ? [s.defaultAssignee] : [],
    parent: ex?.parent_id ?? String(preset['parent_id'] ?? ''),
    service: ex?.service_id ?? '',
    tags: ex?.tags.join(', ') ?? '',
    description: '',
    checklist: [] as string[],
    template: '',
  });
  let errors = $state<Record<string, string>>({});
  const projects = api.ctx.index
    .all('project')
    .filter((p) => !p.archived && p.status !== 'completed' && p.status !== 'cancelled')
    .sort((a, b) => a.name.localeCompare(b.name));
  const services = api.ctx.index.all('service').filter((x) => !x.archived);
  const parents = $derived(
    api.ctx.index
      .all('ticket')
      .filter((x) => x.project_id === f.project && x.id !== id && !x.archived),
  );
  const project = $derived(api.ctx.index.get('project', f.project));

  /** New people typed in the picker are remembered in the team list. */
  function addPerson(name: string) {
    const settings = api.settings();
    if (!settings.team.includes(name)) {
      settings.team = [...settings.team, name];
      void api.saveSettings();
    }
  }

  function applyTemplate() {
    const tpl = builtinTicketTemplates().find((x) => x.name === f.template);
    if (!tpl) return;
    if (!f.title) f.title = tpl.title;
    f.category = tpl.category;
    ({ text: f.estimate, unit: f.estimateUnit } = secondsToUnitInput(tpl.estimated_seconds));
    f.checklist = [...tpl.checklist];
  }

  async function submit(e: Event) {
    e.preventDefault();
    const v = new FormErrors();
    v.require('project', f.project, msg('Projekt ist erforderlich', 'Project is required'));
    const title = v.require('title', f.title, msg('Titel ist erforderlich', 'Title is required'));
    const due = v.take('due', dateField(f.due));
    const est = v.take('estimate', unitDurationField(f.estimate, f.estimateUnit));
    errors = v.errors;
    if (!v.ok) return;
    const common = {
      title,
      priority: f.priority,
      category: f.category,
      due_date: due,
      estimated_seconds: est,
      billable: f.billable,
      assignees: f.assignees,
      parent_id: f.parent || null,
      service_id: f.service || null,
      tags: tagsField(f.tags),
    };
    if (ex) {
      const r = await api.run(
        () => updateTicket(api.ctx, ex.id, { ...common, status: f.status }, ex.updated_at),
        t('common.saved'),
      );
      if (r) close();
    } else {
      const r = await api.run(
        () =>
          createTicket(
            api.ctx,
            {
              ...common,
              project_id: f.project,
              status: f.status,
              depends_on: [],
              checklist: f.checklist.map((text) => ({
                id: ulid(),
                text,
                done: false,
                required: false,
              })),
              sort_order: 0,
              recurring_task_id: null,
              occurrence_key: '',
            },
            f.description,
          ),
        t('common.saved'),
      );
      if (r) {
        close();
        api.router.go({ name: 'ticket', id: r.id });
      }
    }
  }
</script>

<form class="lx-form" onsubmit={submit} novalidate>
  <div class="lx-form-grid">
    {#if !ex}
      <Field label={t('ticket.template')}>
        <select bind:value={f.template} onchange={applyTemplate}
          ><option value="">—</option>{#each builtinTicketTemplates() as tpl (tpl.name)}<option
              value={tpl.name}>{tpl.name}</option
            >{/each}</select
        >
      </Field>
    {/if}
    <Field label={t('ticket.project')} error={errors['project']} required>
      <select bind:value={f.project} disabled={!!ex}
        ><option value="">—</option>{#each projects as p (p.id)}<option value={p.id}
            >{p.name}</option
          >{/each}</select
      >
    </Field>
    <Field label={t('ticket.title')} error={errors['title']} required wide
      ><!-- svelte-ignore a11y_autofocus --><input
        type="text"
        bind:value={f.title}
        autofocus
      /></Field
    >
    <Field label={t('common.status')}
      ><select bind:value={f.status}
        >{#each s.workflow as w (w.key)}<option value={w.key}>{w.label}</option>{/each}</select
      ></Field
    >
    <Field label={t('ticket.priority')}
      ><select bind:value={f.priority}
        >{#each PRIORITIES as p (p)}<option value={p}>{t(`priority.${p}` as never)}</option
          >{/each}</select
      ></Field
    >
    <Field label={t('ticket.category')}
      ><select bind:value={f.category}
        ><option value="">—</option>{#each s.ticketCategories as c (c)}<option value={c}>{c}</option
          >{/each}</select
      ></Field
    >
    <Field label={t('ticket.due')} error={errors['due']}
      ><input type="date" bind:value={f.due} /></Field
    >
    <Field label={t('ticket.estimate')} error={errors['estimate']}
      ><DurationInput
        bind:text={f.estimate}
        bind:unit={f.estimateUnit}
        label={t('ticket.estimate')}
      /></Field
    >
    <fieldset class="lx-fieldset lx-field-wide">
      <legend class="lx-field-label">{t('ticket.assignees')}</legend>
      <AssigneePicker
        bind:selected={f.assignees}
        team={api.settings().team}
        onaddperson={addPerson}
      />
    </fieldset>
    <Field label={t('ticket.parent')}
      ><select bind:value={f.parent}
        ><option value="">—</option>{#each parents as p (p.id)}<option value={p.id}
            >{p.ticket_number} {p.title}</option
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
    <label class="lx-check"
      ><input
        type="checkbox"
        bind:checked={f.billable}
        disabled={project?.billing_model === 'internal'}
      />
      {t('ticket.billable')}{project?.billing_model === 'internal'
        ? msg(' (internes Projekt)', ' (internal project)')
        : ''}</label
    >
    <Field label={t('common.tags')} wide><input type="text" bind:value={f.tags} /></Field>
    {#if !ex}
      <Field label={t('common.description')} wide
        ><MarkdownEditor
          {api}
          bind:value={f.description}
          projectId={f.project || null}
          rows={6}
        /></Field
      >
      {#if f.checklist.length}<div class="lx-field-wide lx-small">
          {t('ticket.checklist')}: {f.checklist.join(' · ')}
        </div>{/if}
    {/if}
  </div>
  <div class="lx-modal-actions">
    <button type="button" onclick={close}>{t('common.cancel')}</button>
    <button type="submit" class="mod-cta">{ex ? t('common.save') : t('common.create')}</button>
  </div>
</form>
