<script lang="ts">
  import { msg } from '@/shared/i18n';
  import type { UiApi } from '../stores/ui-api';
  import { t } from '@/shared/i18n';
  import { createQuote, updateQuote, quoteTotals } from '@/application/use-cases/finance';
  import {
    FormErrors,
    dateField,
    moneyField,
    quantityMilliField,
    percentBpField,
    centsToInput,
  } from './form-utils';
  import { localDate, addDays } from '@/shared/date/time';
  import { money } from '../components/labels';
  import Field from '../components/Field.svelte';

  let {
    api,
    id,
    preset = {},
    close,
  }: { api: UiApi; id?: string; preset?: Record<string, unknown>; close: () => void } = $props();
  // svelte-ignore state_referenced_locally
  const ex = id ? api.ctx.repo.find('quote', id) : undefined;
  const today = localDate(Date.now());
  const rate = centsToInput(api.settings().defaultHourlyRateCents);
  // svelte-ignore state_referenced_locally
  let f = $state({
    customer: ex?.customer_id ?? String(preset['customer_id'] ?? ''),
    project: ex?.project_id ?? '',
    title: ex?.title ?? '',
    issue: ex?.issue_date ?? today,
    valid: ex?.valid_until ?? addDays(today, 30),
    discount: ex ? String(ex.discount_bp / 100).replace('.', ',') : '',
    lines: ex
      ? ex.lines.map((l) => ({
          description: l.description,
          qty: String(l.quantity_milli / 1000).replace('.', ','),
          unit: l.unit,
          price: centsToInput(l.unit_price_cents),
        }))
      : [{ description: '', qty: '1', unit: msg('Std.', 'h'), price: rate }],
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

  function parseLines(v: FormErrors) {
    return f.lines.map((l, i) => ({
      description:
        l.description.trim() ||
        ((v.errors[`line${i}`] = msg('Beschreibung fehlt', 'Description missing')), ''),
      quantity_milli: v.take(`line${i}`, quantityMilliField(l.qty)),
      unit: l.unit.trim() || msg('Std.', 'h'),
      unit_price_cents: v.take(`line${i}`, moneyField(l.price, { required: true })) as number,
    }));
  }
  const preview = $derived.by(() => {
    const v = new FormErrors();
    const lines = parseLines(v);
    const bp = percentBpField(f.discount);
    return v.ok && bp.value !== undefined ? quoteTotals({ lines, discount_bp: bp.value }) : null;
  });

  async function submit(e: Event) {
    e.preventDefault();
    const v = new FormErrors();
    v.require('customer', f.customer, msg('Kunde ist erforderlich', 'Customer is required'));
    const title = v.require('title', f.title, msg('Titel ist erforderlich', 'Title is required'));
    const issue = v.take('issue', dateField(f.issue, true));
    const valid = v.take('valid', dateField(f.valid));
    const discount = v.take('discount', percentBpField(f.discount));
    const lines = parseLines(v);
    if (!lines.length) v.errors['lines'] = msg('Mindestens eine Position', 'At least one line');
    errors = v.errors;
    if (!v.ok) return;
    const data = {
      customer_id: f.customer,
      project_id: f.project || null,
      title,
      issue_date: issue!,
      valid_until: valid,
      currency: api.settings().currency,
      lines,
      discount_bp: discount,
    };
    const r = ex
      ? await api.run(() => updateQuote(api.ctx, ex.id, data, ex.updated_at), t('common.saved'))
      : await api.run(() => createQuote(api.ctx, data, f.notes), t('common.saved'));
    if (r) {
      close();
      api.router.go({ name: 'quote', id: r.id });
    }
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
    <Field label={t('quote.title')} error={errors['title']} required wide
      ><input type="text" bind:value={f.title} /></Field
    >
    <Field label={t('quote.issueDate')} error={errors['issue']} required
      ><input type="date" bind:value={f.issue} /></Field
    >
    <Field label={t('quote.validUntil')} error={errors['valid']}
      ><input type="date" bind:value={f.valid} /></Field
    >
  </div>
  <h4>{t('quote.lines')}</h4>
  <table class="lx-table lx-table-compact lx-edit-table">
    <thead
      ><tr
        ><th>{t('common.description')}</th><th>{t('quote.qty')}</th><th>{t('quote.unit')}</th><th
          >{t('quote.unitPrice')}</th
        ><th></th></tr
      ></thead
    >
    <tbody>
      {#each f.lines as l, i (i)}
        <tr class:lx-has-error={!!errors[`line${i}`]}>
          <td
            ><input
              type="text"
              bind:value={l.description}
              aria-label={t('common.description')}
            /></td
          >
          <td
            ><input
              type="text"
              bind:value={l.qty}
              inputmode="decimal"
              class="lx-narrow"
              aria-label={t('quote.qty')}
            /></td
          >
          <td
            ><input
              type="text"
              bind:value={l.unit}
              class="lx-narrow"
              aria-label={t('quote.unit')}
            /></td
          >
          <td
            ><input
              type="text"
              bind:value={l.price}
              inputmode="decimal"
              class="lx-narrow"
              aria-label={t('quote.unitPrice')}
            /></td
          >
          <td
            ><button
              type="button"
              class="lx-icon-btn"
              aria-label={t('common.delete')}
              onclick={() => (f.lines = f.lines.filter((_, j) => j !== i))}>✕</button
            ></td
          >
        </tr>
        {#if errors[`line${i}`]}<tr
            ><td colspan="5" class="lx-field-error">{errors[`line${i}`]}</td></tr
          >{/if}
      {/each}
    </tbody>
  </table>
  <button
    type="button"
    onclick={() =>
      (f.lines = [...f.lines, { description: '', qty: '1', unit: msg('Std.', 'h'), price: rate }])}
    >+ {t('quote.addLine')}</button
  >
  <div class="lx-form-grid">
    <Field label={t('quote.discount')} error={errors['discount']}
      ><input type="text" bind:value={f.discount} inputmode="decimal" /></Field
    >
    {#if preview}<div class="lx-total-box">
        {t('billing.net')}: <strong>{money(preview.netCents)}</strong>{#if preview.discountCents}
          (−{money(preview.discountCents)}){/if}
      </div>{/if}
    {#if !ex}<Field label={t('common.notes')} wide
        ><textarea rows="2" bind:value={f.notes}></textarea></Field
      >{/if}
  </div>
  <div class="lx-modal-actions">
    <button type="button" onclick={close}>{t('common.cancel')}</button>
    <button type="submit" class="mod-cta">{ex ? t('common.save') : t('common.create')}</button>
  </div>
</form>
