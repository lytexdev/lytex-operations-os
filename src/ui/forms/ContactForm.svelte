<script lang="ts">
  import { msg } from '@/shared/i18n';
  import { confirmDelete } from '../components/delete';
  import type { UiApi } from '../stores/ui-api';
  import { t } from '@/shared/i18n';
  import { createContact, updateContact } from '@/application/use-cases/crm';
  import { FormErrors, emailField } from './form-utils';
  import Field from '../components/Field.svelte';

  let {
    api,
    id,
    preset = {},
    close,
  }: { api: UiApi; id?: string; preset?: Record<string, unknown>; close: () => void } = $props();
  // svelte-ignore state_referenced_locally
  const ex = id ? api.ctx.repo.find('contact', id) : undefined;
  // svelte-ignore state_referenced_locally
  let f = $state({
    customer: ex?.customer_id ?? String(preset['customer_id'] ?? ''),
    first: ex?.first_name ?? '',
    last: ex?.last_name ?? '',
    role: ex?.role ?? '',
    email: ex?.email ?? '',
    phone: ex?.phone ?? '',
    primary: ex?.primary ?? false,
  });
  let errors = $state<Record<string, string>>({});
  const customers = api.ctx.index
    .all('customer')
    .filter((c) => !c.archived)
    .sort((a, b) => a.name.localeCompare(b.name));

  async function submit(e: Event) {
    e.preventDefault();
    const v = new FormErrors();
    v.require('customer', f.customer, msg('Kunde ist erforderlich', 'Customer is required'));
    const last = v.require(
      'last',
      f.last,
      msg('Nachname ist erforderlich', 'Last name is required'),
    );
    const email = v.take('email', emailField(f.email));
    errors = v.errors;
    if (!v.ok) return;
    const data = {
      customer_id: f.customer,
      first_name: f.first.trim(),
      last_name: last,
      role: f.role.trim(),
      email,
      phone: f.phone.trim(),
      primary: f.primary,
    };
    const r = ex
      ? await api.run(() => updateContact(api.ctx, ex.id, data, ex.updated_at), t('common.saved'))
      : await api.run(() => createContact(api.ctx, data), t('common.saved'));
    if (r) close();
  }
</script>

<form class="lx-form" onsubmit={submit} novalidate>
  <div class="lx-form-grid">
    <Field label={t('project.customer')} error={errors['customer']} required wide>
      <select bind:value={f.customer} disabled={!!ex}
        ><option value="">—</option>{#each customers as c (c.id)}<option value={c.id}
            >{c.name}</option
          >{/each}</select
      >
    </Field>
    <Field label={t('contact.firstName')}><input type="text" bind:value={f.first} /></Field>
    <Field label={t('contact.lastName')} error={errors['last']} required
      ><input type="text" bind:value={f.last} /></Field
    >
    <Field label={t('contact.role')}><input type="text" bind:value={f.role} /></Field>
    <Field label={t('customer.email')} error={errors['email']}
      ><input type="email" bind:value={f.email} /></Field
    >
    <Field label={t('customer.phone')}><input type="tel" bind:value={f.phone} /></Field>
    <label class="lx-check"
      ><input type="checkbox" bind:checked={f.primary} /> {t('contact.primary')}</label
    >
  </div>
  <div class="lx-modal-actions">
    {#if ex}<button
        type="button"
        class="mod-warning lx-actions-left"
        onclick={async () => {
          if (await confirmDelete(api, 'contact', ex.id, `${ex.first_name} ${ex.last_name}`))
            close();
        }}>{t('common.delete')}</button
      >{/if}
    {#if ex}<button type="button" onclick={() => api.openNote(ex.id)}>{t('common.openNote')}</button
      ><button
        type="button"
        onclick={async () => {
          await api.run(() => api.ctx.repo.archive('contact', ex.id));
          close();
        }}>{t('common.archive')}</button
      >{/if}
    <button type="button" onclick={close}>{t('common.cancel')}</button>
    <button type="submit" class="mod-cta">{ex ? t('common.save') : t('common.create')}</button>
  </div>
</form>
