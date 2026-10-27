<script lang="ts">
  import { msg } from '@/shared/i18n';
  import type { UiApi } from '../stores/ui-api';
  import { t } from '@/shared/i18n';
  import { CUSTOMER_STATUSES, CURRENCIES, type Customer } from '@/domain/schemas/entities';
  import {
    createCustomer,
    updateCustomer,
    checkCustomerDuplicates,
  } from '@/application/use-cases/crm';
  import {
    FormErrors,
    moneyField,
    emailField,
    urlField,
    tagsField,
    centsToInput,
  } from './form-utils';
  import Field from '../components/Field.svelte';

  let {
    api,
    id,
    preset = {},
    close,
  }: { api: UiApi; id?: string; preset?: Record<string, unknown>; close: () => void } = $props();
  // svelte-ignore state_referenced_locally
  const ex: Customer | undefined = id ? api.ctx.repo.find('customer', id) : undefined;
  // svelte-ignore state_referenced_locally
  let f = $state({
    name: ex?.name ?? String(preset['name'] ?? ''),
    kind: ex?.customer_kind ?? 'business',
    status: ex?.status ?? 'active',
    email: ex?.email ?? '',
    phone: ex?.phone ?? '',
    website: ex?.website ?? '',
    street: ex?.address.street ?? '',
    zip: ex?.address.zip ?? '',
    city: ex?.address.city ?? '',
    country: ex?.address.country ?? 'DE',
    separateBilling: !!ex?.billing_address,
    bStreet: ex?.billing_address?.street ?? '',
    bZip: ex?.billing_address?.zip ?? '',
    bCity: ex?.billing_address?.city ?? '',
    bCountry: ex?.billing_address?.country ?? '',
    vat: ex?.vat_id ?? '',
    taxNo: ex?.tax_number ?? '',
    accId: ex?.external_accounting_id ?? '',
    rate: centsToInput(ex?.default_rate_cents),
    currency: ex?.currency ?? api.settings().currency,
    terms: String(ex?.payment_terms_days ?? 14),
    pwRef: ex?.password_manager_ref ?? '',
    tags: ex?.tags.join(', ') ?? '',
    notes: '',
  });
  let errors = $state<Record<string, string>>({});
  let busy = $state(false);
  const dups = $derived(
    f.name.trim().length >= 3 || f.email || f.vat
      ? checkCustomerDuplicates(api.ctx, {
          id,
          name: f.name,
          email: f.email,
          website: f.website,
          vat_id: f.vat,
          phone: f.phone,
        })
      : [],
  );

  async function submit(e: Event) {
    e.preventDefault();
    const v = new FormErrors();
    const name = v.require('name', f.name, msg('Name ist erforderlich', 'Name is required'));
    const email = v.take('email', emailField(f.email));
    const website = v.take('website', urlField(f.website));
    const rate = v.take('rate', moneyField(f.rate, { min: 0 }));
    const terms = Number(f.terms);
    if (!Number.isInteger(terms) || terms < 0 || terms > 365)
      v.errors['terms'] = msg('Zahl zwischen 0 und 365', 'Number between 0 and 365');
    if (/passw|kennw|pwd/i.test(f.pwRef) && /[:=]/.test(f.pwRef))
      v.errors['pwRef'] = msg(
        'Bitte nur einen Verweis eintragen, kein Passwort',
        'Please enter a reference only, not a password',
      );
    errors = v.errors;
    if (!v.ok) return;
    const data = {
      name,
      customer_kind: f.kind,
      status: f.status,
      email,
      phone: f.phone.trim(),
      website,
      address: {
        street: f.street.trim(),
        zip: f.zip.trim(),
        city: f.city.trim(),
        country: f.country.trim(),
      },
      billing_address: f.separateBilling
        ? {
            street: f.bStreet.trim(),
            zip: f.bZip.trim(),
            city: f.bCity.trim(),
            country: f.bCountry.trim(),
          }
        : null,
      vat_id: f.vat.trim(),
      tax_number: f.taxNo.trim(),
      external_accounting_id: f.accId.trim(),
      default_rate_cents: rate,
      currency: f.currency,
      payment_terms_days: terms,
      password_manager_ref: f.pwRef.trim(),
      tags: tagsField(f.tags),
    };
    busy = true;
    const r = ex
      ? await api.run(() => updateCustomer(api.ctx, ex.id, data, ex.updated_at), t('common.saved'))
      : await api.run(() => createCustomer(api.ctx, data, f.notes), t('common.saved'));
    busy = false;
    if (r) {
      close();
      if (!ex) api.router.go({ name: 'customer', id: r.id });
    }
  }
</script>

<form class="lx-form" onsubmit={submit} novalidate>
  <div class="lx-form-grid">
    <Field label={t('customer.name')} error={errors['name']} required wide
      ><!-- svelte-ignore a11y_autofocus --><input
        type="text"
        bind:value={f.name}
        autofocus
      /></Field
    >
    {#if dups.length}
      <div class="lx-callout lx-tone-warn lx-field-wide">
        <strong>{t('customer.duplicates')}:</strong>
        {#each dups as d (d.customer.id)}<div>
            {d.customer.customer_number}
            {d.customer.name} – {d.reasons.join(', ')}
          </div>{/each}
      </div>
    {/if}
    <Field label={t('customer.kind')}>
      <select bind:value={f.kind}
        ><option value="business">{t('customer.kind.business')}</option><option value="private"
          >{t('customer.kind.private')}</option
        ></select
      >
    </Field>
    <Field label={t('common.status')}>
      <select bind:value={f.status}
        >{#each CUSTOMER_STATUSES as s (s)}<option value={s}
            >{t(`customer.status.${s}` as never)}</option
          >{/each}</select
      >
    </Field>
    <Field label={t('customer.email')} error={errors['email']}
      ><input type="email" bind:value={f.email} /></Field
    >
    <Field label={t('customer.phone')}><input type="tel" bind:value={f.phone} /></Field>
    <Field label={t('customer.website')} error={errors['website']} wide
      ><input type="url" bind:value={f.website} /></Field
    >
    <Field label={t('customer.street')} wide><input type="text" bind:value={f.street} /></Field>
    <Field label={t('customer.zip')}><input type="text" bind:value={f.zip} /></Field>
    <Field label={t('customer.city')}><input type="text" bind:value={f.city} /></Field>
    <Field label={t('customer.country')}><input type="text" bind:value={f.country} /></Field>
    <label class="lx-check lx-field-wide"
      ><input type="checkbox" bind:checked={f.separateBilling} />
      {t('customer.billingAddress')}</label
    >
    {#if f.separateBilling}
      <Field label={t('customer.street')} wide><input type="text" bind:value={f.bStreet} /></Field>
      <Field label={t('customer.zip')}><input type="text" bind:value={f.bZip} /></Field>
      <Field label={t('customer.city')}><input type="text" bind:value={f.bCity} /></Field>
      <Field label={t('customer.country')}><input type="text" bind:value={f.bCountry} /></Field>
    {/if}
    <Field label={t('customer.vatId')}><input type="text" bind:value={f.vat} /></Field>
    <Field label={t('customer.taxNumber')}><input type="text" bind:value={f.taxNo} /></Field>
    <Field label={t('customer.accountingId')}><input type="text" bind:value={f.accId} /></Field>
    <Field
      label={t('customer.rate')}
      error={errors['rate']}
      hint={`${msg('Leer = Standard', 'Empty = default')} (${(api.settings().defaultHourlyRateCents / 100).toFixed(2)})`}
      ><input type="text" inputmode="decimal" bind:value={f.rate} /></Field
    >
    <Field label={msg('Währung', 'Currency')}
      ><select bind:value={f.currency}
        >{#each CURRENCIES as c (c)}<option value={c}>{c}</option>{/each}</select
      ></Field
    >
    <Field label={t('customer.paymentTerms')} error={errors['terms']}
      ><input type="number" min="0" max="365" bind:value={f.terms} /></Field
    >
    <Field
      label={t('customer.passwordRef')}
      error={errors['pwRef']}
      hint={msg(
        'z. B. „Bitwarden: Muster GmbH / Hosting“',
        'e.g. “Bitwarden: Example Ltd / Hosting”',
      )}
      wide><input type="text" bind:value={f.pwRef} autocomplete="off" /></Field
    >
    <Field label={t('common.tags')} wide><input type="text" bind:value={f.tags} /></Field>
    {#if !ex}<Field label={t('common.notes')} wide
        ><textarea rows="3" bind:value={f.notes}></textarea></Field
      >{/if}
  </div>
  <div class="lx-modal-actions">
    <button type="button" onclick={close}>{t('common.cancel')}</button>
    <button type="submit" class="mod-cta" disabled={busy}
      >{ex ? t('common.save') : t('common.create')}</button
    >
  </div>
</form>
