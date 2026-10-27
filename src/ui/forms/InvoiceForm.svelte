<script lang="ts">
  import { msg } from '@/shared/i18n';
  import type { UiApi } from '../stores/ui-api';
  import { t } from '@/shared/i18n';
  import { confirmInvoice, recordPayment } from '@/application/use-cases/billing';
  import { FormErrors, dateField, moneyField, centsToInput } from './form-utils';
  import { localDate } from '@/shared/date/time';
  import { money } from '../components/labels';
  import Field from '../components/Field.svelte';

  let {
    api,
    id,
    mode,
    close,
  }: {
    api: UiApi;
    id?: string;
    mode: 'invoice' | 'payment';
    preset?: Record<string, unknown>;
    close: () => void;
  } = $props();
  const b = api.ctx.repo.get('billing_batch', id!);
  let ref = $state('');
  let day = $state(localDate(Date.now()));
  let amount = $state(centsToInput(b.net_cents));
  let errors = $state<Record<string, string>>({});

  async function submit(e: Event) {
    e.preventDefault();
    const v = new FormErrors();
    const d = v.take('day', dateField(day, true));
    if (mode === 'invoice') {
      const r = v.require(
        'ref',
        ref,
        msg('Rechnungsnummer ist erforderlich', 'Invoice number is required'),
      );
      errors = v.errors;
      if (!v.ok) return;
      // run() resolves undefined on failure, so return an explicit marker on success.
      if (
        await api.run(
          async () => (await confirmInvoice(api.ctx, b.id, r, d!), true),
          t('common.saved'),
        )
      )
        close();
    } else {
      const cents = v.take('amount', moneyField(amount, { required: true, min: 1 }));
      errors = v.errors;
      if (!v.ok) return;
      if (
        await api.run(
          async () => (await recordPayment(api.ctx, b.id, d!, cents!), true),
          t('common.saved'),
        )
      )
        close();
    }
  }
</script>

<form class="lx-form" onsubmit={submit} novalidate>
  <p>{b.batch_number} · {money(b.net_cents, b.currency)}</p>
  {#if mode === 'invoice'}<p class="lx-muted lx-small">
      {msg(
        'Bestätige erst, nachdem die Rechnung im Buchhaltungssystem erstellt wurde. Alle enthaltenen       Zeiteinträge werden danach als „abgerechnet“ gesperrt.',
        'Confirm only after the invoice was created in your accounting system. All included time entries are then locked as “invoiced”.',
      )}
    </p>{/if}
  <div class="lx-form-grid">
    {#if mode === 'invoice'}
      <Field label={t('billing.invoiceRef')} error={errors['ref']} required
        ><!-- svelte-ignore a11y_autofocus --><input
          type="text"
          bind:value={ref}
          autofocus
        /></Field
      >
      <Field label={t('billing.invoiceDate')} error={errors['day']} required
        ><input type="date" bind:value={day} /></Field
      >
    {:else}
      <Field label={t('billing.paidAt')} error={errors['day']} required
        ><input type="date" bind:value={day} /></Field
      >
      <Field label={t('billing.paidAmount')} error={errors['amount']} required
        ><input type="text" inputmode="decimal" bind:value={amount} /></Field
      >
    {/if}
  </div>
  <div class="lx-modal-actions">
    <button type="button" onclick={close}>{t('common.cancel')}</button>
    <button type="submit" class="mod-cta">{t('common.confirm')}</button>
  </div>
</form>
