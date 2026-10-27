<script lang="ts">
  import { msg } from '@/shared/i18n';
  import DurationInput from '../components/DurationInput.svelte';
  import { PROJECT_KEY_RE, projectKeyMessage } from '@/domain/schemas/entities';
  import type { UiApi } from '../stores/ui-api';
  import { t } from '@/shared/i18n';
  import {
    PROJECT_STATUSES,
    BILLING_MODELS,
    CURRENCIES,
    type Project,
  } from '@/domain/schemas/entities';
  import { PRIORITIES } from '@/domain/schemas/common';
  import {
    createProject,
    updateProject,
    takenKeys,
    validateProjectRules,
  } from '@/application/use-cases/projects';
  import { suggestProjectKey } from '@/application/use-cases/numbering';
  import {
    FormErrors,
    moneyField,
    hoursField,
    dateField,
    tagsField,
    centsToInput,
    secondsToInput,
    secondsToUnitInput,
    unitDurationField,
  } from './form-utils';
  import Field from '../components/Field.svelte';

  let {
    api,
    id,
    preset = {},
    close,
  }: { api: UiApi; id?: string; preset?: Record<string, unknown>; close: () => void } = $props();
  // svelte-ignore state_referenced_locally
  const ex: Project | undefined = id ? api.ctx.repo.find('project', id) : undefined;
  const p = (k: string) => preset[k];
  // svelte-ignore state_referenced_locally
  let f = $state({
    name: ex?.name ?? String(p('name') ?? ''),
    key: ex?.key ?? '',
    customer: ex?.customer_id ?? String(p('customer_id') ?? ''),
    status: ex?.status ?? 'active',
    priority: ex?.priority ?? 'normal',
    start: ex?.start_date ?? '',
    deadline: ex?.deadline ?? '',
    model:
      ex?.billing_model ??
      (String(p('billing_model') ?? 'time_and_materials') as Project['billing_model']),
    service: ex?.service_id ?? '',
    rate: centsToInput(ex?.rate_cents),
    unit: ex?.billing_unit ?? 'hour',
    dayRate: centsToInput(ex?.daily_rate_cents),
    fixed: centsToInput(ex?.fixed_price_cents),
    retFee: centsToInput(ex?.retainer_monthly_fee_cents),
    retHours: secondsToInput(ex?.retainer_included_seconds),
    budget: centsToInput(ex?.budget_cents ?? (p('budget_cents') as number | undefined)),
    budgetHours: secondsToInput(ex?.budget_seconds),
    estimate: secondsToUnitInput(ex?.estimated_seconds).text,
    estimateUnit: secondsToUnitInput(ex?.estimated_seconds).unit,
    costRate: centsToInput(ex?.internal_cost_rate_cents),
    currency: ex?.currency ?? api.settings().currency,
    docs: ex?.doc_links.join('\n') ?? '',
    tags: ex?.tags.join(', ') ?? '',
    description: '',
  });
  let step = $state(0);
  // "Intern (LYTEX)" means no customer → billing model is forced to internal. When a customer is
  // chosen again, an automatically set "internal" falls back to time & materials.
  let autoInternal = false;
  $effect(() => {
    if (!f.customer && f.model !== 'internal') {
      f.model = 'internal';
      autoInternal = true;
    } else if (f.customer && autoInternal && f.model === 'internal') {
      f.model = 'time_and_materials';
      autoInternal = false;
    }
  });
  let errors = $state<Record<string, string>>({});
  const customers = api.ctx.index
    .all('customer')
    .filter((c) => !c.archived)
    .sort((a, b) => a.name.localeCompare(b.name));
  const services = api.ctx.index.all('service').filter((s) => !s.archived);
  const keyHint = $derived(
    f.key || (f.name ? suggestProjectKey(f.name, takenKeys(api.ctx, id)) : ''),
  );
  const STEPS = [t('project.step.basics'), t('project.step.billing'), t('project.step.budget')];

  function collect() {
    const v = new FormErrors();
    const name = v.require(
      'name',
      f.name,
      msg('Projektname ist erforderlich', 'Project name is required'),
    );
    const key = f.key.trim().toUpperCase();
    if (key && !PROJECT_KEY_RE.test(key)) v.errors['key'] = projectKeyMessage();
    const data = {
      name,
      key: key || undefined,
      customer_id: f.customer || null,
      status: f.status,
      priority: f.priority,
      start_date: v.take('start', dateField(f.start)),
      deadline: v.take('deadline', dateField(f.deadline)),
      completed_date: ex?.completed_date ?? null,
      // Without a customer ("Intern (LYTEX)") a project can only be internal.
      billing_model: f.customer ? f.model : 'internal',
      service_id: f.service || null,
      rate_cents: v.take('rate', moneyField(f.rate, { min: 0 })),
      billing_unit: f.unit,
      daily_rate_cents: v.take('dayRate', moneyField(f.dayRate, { min: 0 })),
      fixed_price_cents: v.take('fixed', moneyField(f.fixed, { min: 0 })),
      retainer_monthly_fee_cents: v.take('retFee', moneyField(f.retFee, { min: 0 })),
      retainer_included_seconds: v.take('retHours', hoursField(f.retHours)),
      budget_cents: v.take('budget', moneyField(f.budget, { min: 0 })),
      budget_seconds: v.take('budgetHours', hoursField(f.budgetHours)),
      estimated_seconds: v.take('estimate', unitDurationField(f.estimate, f.estimateUnit)),
      internal_cost_rate_cents: v.take('costRate', moneyField(f.costRate, { min: 0 })),
      currency: f.currency,
      milestones: ex?.milestones ?? [],
      doc_links: f.docs
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
      tags: tagsField(f.tags),
    };
    if (v.ok) for (const rule of validateProjectRules(data)) v.errors[rule.field] = rule.message;
    return { v, data };
  }

  function stepOf(field: string): number {
    if (['name', 'key', 'customer', 'start', 'deadline'].includes(field)) return 0;
    if (['rate', 'dayRate', 'fixed', 'retFee', 'retHours'].includes(field)) return 1;
    return 2;
  }

  async function submit(e: Event) {
    e.preventDefault();
    const { v, data } = collect();
    errors = v.errors;
    if (!v.ok) {
      step = Math.min(...Object.keys(v.errors).map(stepOf));
      return;
    }
    if (!ex && step < 2) {
      step++;
      return;
    }
    const r = ex
      ? await api.run(
          () => updateProject(api.ctx, ex.id, { ...data, key: data.key ?? ex.key }, ex.updated_at),
          t('common.saved'),
        )
      : await api.run(() => createProject(api.ctx, data, f.description), t('common.saved'));
    if (r) {
      close();
      if (!ex) api.router.go({ name: 'project', id: r.id });
    }
  }
</script>

<form class="lx-form" onsubmit={submit} novalidate>
  <ol class="lx-steps">
    {#each STEPS as s, i (i)}<li class:is-active={step === i}>
        <button type="button" class="lx-link" onclick={() => (step = i)}>{i + 1}. {s}</button>
      </li>{/each}
  </ol>
  <div class="lx-form-grid">
    {#if step === 0}
      <Field label={t('project.name')} error={errors['name']} required wide
        ><!-- svelte-ignore a11y_autofocus --><input
          type="text"
          bind:value={f.name}
          autofocus
        /></Field
      >
      <Field
        label={t('project.key')}
        error={errors['key']}
        hint={ex
          ? msg('Nach Anlage von Tickets fest', 'Fixed once tickets exist')
          : `${msg('Vorschlag', 'Suggestion')}: ${keyHint}`}
        ><input type="text" bind:value={f.key} placeholder={keyHint} maxlength="10" /></Field
      >
      <Field label={t('project.customer')} error={errors['customer']}>
        <select bind:value={f.customer}
          ><option value="">{t('common.internal')}</option>{#each customers as c (c.id)}<option
              value={c.id}>{c.name}</option
            >{/each}</select
        >
      </Field>
      <Field label={t('common.status')}
        ><select bind:value={f.status}
          >{#each PROJECT_STATUSES as s (s)}<option value={s}
              >{t(`project.status.${s}` as never)}</option
            >{/each}</select
        ></Field
      >
      <Field label={t('project.priority')}
        ><select bind:value={f.priority}
          >{#each PRIORITIES as s (s)}<option value={s}>{t(`priority.${s}` as never)}</option
            >{/each}</select
        ></Field
      >
      <Field label={t('project.start')} error={errors['start']}
        ><input type="date" bind:value={f.start} /></Field
      >
      <Field label={t('project.deadline')} error={errors['deadline']}
        ><input type="date" bind:value={f.deadline} /></Field
      >
      {#if !ex}<Field label={t('common.description')} wide
          ><textarea rows="3" bind:value={f.description}></textarea></Field
        >{/if}
    {:else if step === 1}
      <fieldset class="lx-fieldset lx-field-wide">
        <legend class="lx-field-label">{t('project.billingModel')}</legend>
        <div class="lx-radio-row">
          {#each BILLING_MODELS as m (m)}<label class="lx-check"
              ><input
                type="radio"
                name="bm"
                value={m}
                bind:group={f.model}
                disabled={!f.customer && m !== 'internal'}
              />
              {t(`project.bm.${m}` as never)}</label
            >{/each}
        </div>
        {#if !f.customer}<span class="lx-field-hint">{t('project.internalOnly')}</span>{/if}
      </fieldset>
      {#if f.model !== 'internal'}
        <Field
          label={t('project.rate')}
          error={errors['rate']}
          hint={msg('Leer = Kunde/Leistung/Standard', 'Empty = customer/service/default')}
          ><input type="text" inputmode="decimal" bind:value={f.rate} /></Field
        >
        <Field label={t('project.service')}
          ><select bind:value={f.service}
            ><option value="">—</option>{#each services as s (s.id)}<option value={s.id}
                >{s.name}</option
              >{/each}</select
          ></Field
        >
        <Field
          label={t('project.billingUnit')}
          hint={msg(
            'Tagessatz nur bei vertraglicher Tagesabrechnung',
            'Daily rate only for contractual billing per day',
          )}
          ><select bind:value={f.unit}
            ><option value="hour">{t('project.unit.hour')}</option><option value="day"
              >{t('project.unit.day')}</option
            ></select
          ></Field
        >
        {#if f.unit === 'day'}<Field label={t('project.dailyRate')} error={errors['dayRate']}
            ><input
              type="text"
              inputmode="decimal"
              bind:value={f.dayRate}
              placeholder={(api.settings().defaultDailyRateCents / 100).toFixed(2)}
            /></Field
          >{/if}
        {#if f.model === 'fixed_price'}<Field
            label={t('project.fixedPrice')}
            error={errors['fixed']}
            required><input type="text" inputmode="decimal" bind:value={f.fixed} /></Field
          >{/if}
        {#if f.model === 'retainer'}
          <Field label={t('project.retainerFee')} error={errors['retFee']} required
            ><input type="text" inputmode="decimal" bind:value={f.retFee} /></Field
          >
          <Field label={t('project.retainerHours')} error={errors['retHours']}
            ><input type="text" bind:value={f.retHours} placeholder="10" /></Field
          >
        {/if}
        <Field label={msg('Währung', 'Currency')}
          ><select bind:value={f.currency}
            >{#each CURRENCIES as c (c)}<option value={c}>{c}</option>{/each}</select
          ></Field
        >
      {:else}
        <p class="lx-muted lx-field-wide">
          {msg(
            'Interne Projekte sind nie abrechenbar. Zeit wird trotzdem erfasst und ausgewertet.',
            'Internal projects are never billable. Time is still tracked and analysed.',
          )}
        </p>
      {/if}
    {:else}
      <Field
        label={t('project.budget')}
        error={errors['budget']}
        hint={msg('Vertraglich mit dem Kunden vereinbart', 'Agreed with the customer')}
        ><input type="text" inputmode="decimal" bind:value={f.budget} /></Field
      >
      <Field label={t('project.budgetHours')} error={errors['budgetHours']}
        ><input type="text" bind:value={f.budgetHours} /></Field
      >
      <Field
        label={t('project.estimate')}
        error={errors['estimate']}
        hint={msg('Interne Planung, nicht vertraglich', 'Internal planning, not contractual')}
        ><DurationInput
          bind:text={f.estimate}
          bind:unit={f.estimateUnit}
          label={t('project.estimate')}
        /></Field
      >
      <Field
        label={t('project.costRate')}
        error={errors['costRate']}
        hint={msg('Für Profitabilität', 'For profitability')}
        ><input type="text" inputmode="decimal" bind:value={f.costRate} /></Field
      >
      <Field label={t('project.docs')} wide
        ><textarea rows="3" bind:value={f.docs} placeholder="[[Dokumentation/Setup]]"
        ></textarea></Field
      >
      <Field label={t('common.tags')} wide><input type="text" bind:value={f.tags} /></Field>
    {/if}
  </div>
  <div class="lx-modal-actions">
    <button type="button" onclick={close}>{t('common.cancel')}</button>
    {#if step > 0}<button type="button" onclick={() => step--}>{t('common.back')}</button>{/if}
    {#if !ex && step < 2}
      <button type="submit" class="mod-cta">{t('common.next')}</button>
    {:else}
      <button type="submit" class="mod-cta">{ex ? t('common.save') : t('common.create')}</button>
    {/if}
  </div>
</form>
