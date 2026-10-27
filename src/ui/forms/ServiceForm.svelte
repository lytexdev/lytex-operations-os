<script lang="ts">
  import { msg } from '@/shared/i18n';
  import { confirmDelete } from '../components/delete';
  import type { UiApi } from '../stores/ui-api';
  import { t } from '@/shared/i18n';
  import { FormErrors, moneyField, centsToInput } from './form-utils';
  import Field from '../components/Field.svelte';

  let {
    api,
    id,
    close,
  }: { api: UiApi; id?: string; preset?: Record<string, unknown>; close: () => void } = $props();
  const ex = id ? api.ctx.repo.find('service', id) : undefined;
  let f = $state({
    name: ex?.name ?? '',
    rate: centsToInput(ex?.rate_cents),
    billable: ex?.billable ?? true,
    description: ex?.description ?? '',
  });
  let errors = $state<Record<string, string>>({});

  async function submit(e: Event) {
    e.preventDefault();
    const v = new FormErrors();
    const name = v.require('name', f.name, msg('Name ist erforderlich', 'Name is required'));
    const rate = v.take('rate', moneyField(f.rate, { min: 0 }));
    errors = v.errors;
    if (!v.ok) return;
    const data = {
      name,
      rate_cents: rate,
      billable: f.billable,
      description: f.description.trim(),
    };
    const r = ex
      ? await api.run(
          () =>
            api.ctx.repo.update('service', ex.id, (d) => ({ ...d, ...data }), {
              expectedUpdatedAt: ex.updated_at,
            }),
          t('common.saved'),
        )
      : await api.run(() => api.ctx.repo.create('service', data), t('common.saved'));
    if (r) close();
  }
</script>

<form class="lx-form" onsubmit={submit} novalidate>
  <div class="lx-form-grid">
    <Field label={t('service.name')} error={errors['name']} required
      ><input type="text" bind:value={f.name} /></Field
    >
    <Field
      label={t('service.rate')}
      error={errors['rate']}
      hint={msg('Leer = Standardsatz', 'Empty = default rate')}
      ><input type="text" inputmode="decimal" bind:value={f.rate} /></Field
    >
    <label class="lx-check"
      ><input type="checkbox" bind:checked={f.billable} /> {t('ticket.billable')}</label
    >
    <Field label={t('common.description')} wide
      ><input type="text" bind:value={f.description} /></Field
    >
  </div>
  <div class="lx-modal-actions">
    {#if ex}<button
        type="button"
        class="mod-warning lx-actions-left"
        onclick={async () => {
          if (await confirmDelete(api, 'service', ex.id, ex.name)) close();
        }}>{t('common.delete')}</button
      >{/if}
    <button type="button" onclick={close}>{t('common.cancel')}</button>
    <button type="submit" class="mod-cta">{ex ? t('common.save') : t('common.create')}</button>
  </div>
</form>
