<script lang="ts">
  import { msg } from '@/shared/i18n';
  import type { UiApi } from '../stores/ui-api';
  import { t } from '@/shared/i18n';
  import { INTERACTION_KINDS } from '@/domain/schemas/entities';
  import { createInteraction } from '@/application/use-cases/crm';
  import { FormErrors, dateTimeField, dateField } from './form-utils';
  import { localDate, formatLocalTime, toIso } from '@/shared/date/time';
  import Field from '../components/Field.svelte';

  let {
    api,
    preset = {},
    close,
  }: { api: UiApi; id?: string; preset?: Record<string, unknown>; close: () => void } = $props();
  // svelte-ignore state_referenced_locally
  let f = $state({
    customer: String(preset['customer_id'] ?? ''),
    project: String(preset['project_id'] ?? ''),
    kind: 'call' as (typeof INTERACTION_KINDS)[number],
    subject: '',
    date: localDate(Date.now()),
    time: formatLocalTime(Date.now()),
    followUp: '',
    notes: '',
  });
  let errors = $state<Record<string, string>>({});
  const customers = api.ctx.index
    .all('customer')
    .filter((c) => !c.archived)
    .sort((a, b) => a.name.localeCompare(b.name));
  const projects = $derived(
    api.ctx.index.all('project').filter((p) => p.customer_id === f.customer && !p.archived),
  );

  async function submit(e: Event) {
    e.preventDefault();
    const v = new FormErrors();
    v.require('customer', f.customer, msg('Kunde ist erforderlich', 'Customer is required'));
    const subject = v.require(
      'subject',
      f.subject,
      msg('Betreff ist erforderlich', 'Subject is required'),
    );
    const at = v.take('date', dateTimeField(f.date, f.time));
    const follow = v.take('followUp', dateField(f.followUp));
    errors = v.errors;
    if (!v.ok) return;
    const r = await api.run(
      () =>
        createInteraction(
          api.ctx,
          {
            customer_id: f.customer,
            project_id: f.project || null,
            contact_ids: [],
            kind: f.kind,
            occurred_at: toIso(at),
            subject,
            follow_up_date: follow,
          },
          f.notes,
        ),
      t('common.saved'),
    );
    if (r) close();
  }
</script>

<form class="lx-form" onsubmit={submit} novalidate>
  <div class="lx-form-grid">
    <Field label={t('project.customer')} error={errors['customer']} required
      ><select bind:value={f.customer}
        ><option value="">—</option>{#each customers as c (c.id)}<option value={c.id}
            >{c.name}</option
          >{/each}</select
      ></Field
    >
    <Field label={t('ticket.project')}
      ><select bind:value={f.project}
        ><option value="">—</option>{#each projects as p (p.id)}<option value={p.id}
            >{p.name}</option
          >{/each}</select
      ></Field
    >
    <Field label={t('interaction.kind')}
      ><select bind:value={f.kind}
        >{#each INTERACTION_KINDS as k (k)}<option value={k}
            >{t(`interaction.kind.${k}` as never)}</option
          >{/each}</select
      ></Field
    >
    <Field label={t('interaction.subject')} error={errors['subject']} required
      ><input type="text" bind:value={f.subject} /></Field
    >
    <Field label={t('time.date')} error={errors['date']}
      ><input type="date" bind:value={f.date} /></Field
    >
    <Field label={t('time.start')}><input type="time" bind:value={f.time} /></Field>
    <Field label={t('interaction.followUp')} error={errors['followUp']}
      ><input type="date" bind:value={f.followUp} /></Field
    >
    <Field label={t('common.notes')} wide><textarea rows="4" bind:value={f.notes}></textarea></Field
    >
  </div>
  <div class="lx-modal-actions">
    <button type="button" onclick={close}>{t('common.cancel')}</button>
    <button type="submit" class="mod-cta">{t('common.create')}</button>
  </div>
</form>
