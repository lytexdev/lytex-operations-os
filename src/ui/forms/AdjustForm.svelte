<script lang="ts">
  import { msg } from '@/shared/i18n';
  import type { UiApi } from '../stores/ui-api';
  import { t } from '@/shared/i18n';
  import { createAdjustment } from '@/application/use-cases/time';
  import { FormErrors, durationField } from './form-utils';
  import { dur, date, money } from '../components/labels';
  import Field from '../components/Field.svelte';

  let {
    api,
    id,
    close,
  }: { api: UiApi; id?: string; preset?: Record<string, unknown>; close: () => void } = $props();
  // svelte-ignore state_referenced_locally
  const e = api.ctx.repo.get('time_entry', id!);
  let delta = $state('');
  let reason = $state('');
  let errors = $state<Record<string, string>>({});

  async function submit(ev: Event) {
    ev.preventDefault();
    const v = new FormErrors();
    const d = v.take('delta', durationField(delta, { required: true, allowNegative: true }));
    const r = v.require('reason', reason, msg('Begründung ist erforderlich', 'Reason is required'));
    errors = v.errors;
    if (!v.ok) return;
    const res = await api.run(() => createAdjustment(api.ctx, e.id, d!, r), t('common.saved'));
    if (res) close();
  }
</script>

<form class="lx-form" onsubmit={submit} novalidate>
  <p>
    {date(e.started_at)} · {e.description} · {dur(e.duration_seconds)} · {money(e.rate_cents)}/h
  </p>
  <p class="lx-muted lx-small">
    {msg(
      'Der abgerechnete Eintrag bleibt unverändert. Die Korrektur wird als eigener Eintrag gespeichert     und im nächsten Abrechnungslauf berücksichtigt.',
      'The invoiced entry stays unchanged. The adjustment is saved as a separate entry and billed in the next billing batch.',
    )}
  </p>
  <div class="lx-form-grid">
    <Field label={t('time.adjustDelta')} error={errors['delta']} required
      ><input type="text" bind:value={delta} placeholder="-0:30" /></Field
    >
    <Field label={t('time.reason')} error={errors['reason']} required wide
      ><input type="text" bind:value={reason} /></Field
    >
  </div>
  <div class="lx-modal-actions">
    <button type="button" onclick={close}>{t('common.cancel')}</button>
    <button type="submit" class="mod-cta">{t('time.adjust')}</button>
  </div>
</form>
