<script lang="ts">
  import { msg } from '@/shared/i18n';
  import { confirmDelete } from '../components/delete';
  import type { UiApi } from '../stores/ui-api';
  import { t } from '@/shared/i18n';
  import { createExpense, updateExpense } from '@/application/use-cases/finance';
  import { FormErrors, dateField, moneyField, tagsField, centsToInput } from './form-utils';
  import { localDate } from '@/shared/date/time';
  import Field from '../components/Field.svelte';

  let {
    api,
    id,
    preset = {},
    close,
  }: { api: UiApi; id?: string; preset?: Record<string, unknown>; close: () => void } = $props();
  // svelte-ignore state_referenced_locally
  const ex = id ? api.ctx.repo.find('expense', id) : undefined;
  const s = api.settings();
  // svelte-ignore state_referenced_locally
  let f = $state({
    project: ex?.project_id ?? String(preset['project_id'] ?? ''),
    customer: ex?.customer_id ?? '',
    date: ex?.date ?? localDate(Date.now()),
    vendor: ex?.vendor ?? '',
    description: ex?.description ?? '',
    category: ex?.category ?? '',
    amount: centsToInput(ex?.amount_cents),
    reimbursable: ex?.reimbursable ?? false,
    billable: ex ? ex.billing_status !== 'not_billable' : false,
    receipt: ex?.receipt ?? '',
    tags: ex?.tags.join(', ') ?? '',
  });
  let errors = $state<Record<string, string>>({});
  const locked = ex && (ex.billing_status === 'reserved' || ex.billing_status === 'invoiced');
  const projects = api.ctx.index
    .all('project')
    .filter((p) => !p.archived)
    .sort((a, b) => a.name.localeCompare(b.name));
  const customers = api.ctx.index
    .all('customer')
    .filter((c) => !c.archived)
    .sort((a, b) => a.name.localeCompare(b.name));

  async function submit(e: Event) {
    e.preventDefault();
    const v = new FormErrors();
    const description = v.require(
      'description',
      f.description,
      msg('Beschreibung ist erforderlich', 'Description is required'),
    );
    const date = v.take('date', dateField(f.date, true));
    const amount = v.take('amount', moneyField(f.amount, { required: true, min: 1 }));
    errors = v.errors;
    if (!v.ok) return;
    const data = {
      project_id: f.project || null,
      customer_id: f.customer || null,
      date: date!,
      vendor: f.vendor.trim(),
      description,
      category: f.category,
      amount_cents: amount!,
      currency: s.currency,
      reimbursable: f.reimbursable,
      receipt: f.receipt.trim(),
      tags: tagsField(f.tags),
    };
    const r = ex
      ? await api.run(() => updateExpense(api.ctx, ex.id, data, ex.updated_at), t('common.saved'))
      : await api.run(
          () =>
            createExpense(api.ctx, {
              ...data,
              billing_status: f.billable ? 'unbilled' : 'not_billable',
              billing_batch_id: null,
            }),
          t('common.saved'),
        );
    if (r) close();
  }
</script>

<form class="lx-form" onsubmit={submit} novalidate>
  {#if locked}<p class="lx-callout lx-tone-warn">
      {msg(
        'Diese Ausgabe ist in Abrechnung und kann nicht geändert werden.',
        'This expense is being billed and cannot be changed.',
      )}
    </p>{/if}
  <div class="lx-form-grid">
    <Field label={t('ticket.project')}
      ><select bind:value={f.project} disabled={locked}
        ><option value="">—</option>{#each projects as p (p.id)}<option value={p.id}
            >{p.name}</option
          >{/each}</select
      ></Field
    >
    <Field
      label={t('project.customer')}
      hint={msg('Wird aus dem Projekt übernommen', 'Taken from the project')}
      ><select bind:value={f.customer} disabled={locked || !!f.project}
        ><option value="">—</option>{#each customers as c (c.id)}<option value={c.id}
            >{c.name}</option
          >{/each}</select
      ></Field
    >
    <Field label={t('time.date')} error={errors['date']} required
      ><input type="date" bind:value={f.date} disabled={locked} /></Field
    >
    <Field label={t('expense.vendor')}
      ><input type="text" bind:value={f.vendor} disabled={locked} /></Field
    >
    <Field label={t('common.description')} error={errors['description']} required wide
      ><input type="text" bind:value={f.description} disabled={locked} /></Field
    >
    <Field label={t('expense.category')}
      ><select bind:value={f.category} disabled={locked}
        ><option value="">—</option>{#each s.expenseCategories as c (c)}<option value={c}
            >{c}</option
          >{/each}</select
      ></Field
    >
    <Field label={t('expense.amount')} error={errors['amount']} required
      ><input type="text" inputmode="decimal" bind:value={f.amount} disabled={locked} /></Field
    >
    <label class="lx-check"
      ><input type="checkbox" bind:checked={f.reimbursable} disabled={locked} />
      {t('expense.reimbursable')}</label
    >
    {#if !ex}<label class="lx-check"
        ><input type="checkbox" bind:checked={f.billable} /> {t('expense.billable')}</label
      >{/if}
    <Field label={t('expense.receipt')} wide
      ><input
        type="text"
        bind:value={f.receipt}
        disabled={locked}
        placeholder={msg('[[Belege/2026-10-20 Hoster.pdf]]', '[[Receipts/2026-10-20 Hosting.pdf]]')}
      /></Field
    >
    <Field label={t('common.tags')} wide
      ><input type="text" bind:value={f.tags} disabled={locked} /></Field
    >
  </div>
  <div class="lx-modal-actions">
    {#if ex}<button
        type="button"
        class="mod-warning lx-actions-left"
        onclick={async () => {
          if (await confirmDelete(api, 'expense', ex.id, ex.description)) close();
        }}>{t('common.delete')}</button
      >{/if}
    {#if ex}<button type="button" onclick={() => api.openNote(ex.id)}>{t('common.openNote')}</button
      >{/if}
    <button type="button" onclick={close}>{t('common.cancel')}</button>
    {#if !locked}<button type="submit" class="mod-cta"
        >{ex ? t('common.save') : t('common.create')}</button
      >{/if}
  </div>
</form>
