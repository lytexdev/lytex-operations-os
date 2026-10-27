<script lang="ts">
  import { msg } from '@/shared/i18n';
  import { dep } from '../components/labels';
  import type { UiApi } from '../stores/ui-api';
  import { t } from '@/shared/i18n';
  import {
    filterEntries,
    previewBatch,
    createBatch,
    type BatchRequest,
  } from '@/application/use-cases/billing';
  import { setBillingStatus } from '@/application/use-cases/time';
  import { isExpenseBatchEligible } from '@/domain/services/billing';
  import { percentBpField } from '../forms/form-utils';
  import { describeRounding } from '@/domain/services/rounding';
  import { money, dur, date } from '../components/labels';
  import Section from '../components/Section.svelte';
  import StatusBadge from '../components/StatusBadge.svelte';
  import EntryTable from './EntryTable.svelte';

  let { api }: { api: UiApi } = $props();
  const version = api.version;
  const route = api.router.route;
  let customer = $state($route.params?.['customer'] ?? '');
  let project = $state('');
  let from = $state('');
  let to = $state('');
  let statusFilter = $state<'open' | 'approved'>('open');
  let selected = $state<string[]>([]);
  let expenseSel = $state<string[]>([]);
  let fixed = $state<string[]>([]);
  let retainer = $state<Record<string, string>>({});
  let discount = $state('');
  let batchFilter = $state<'active' | 'all'>('active');

  const customers = $derived(
    dep($version, () =>
      api.ctx.index
        .all('customer')
        .filter((c) => !c.archived)
        .sort((a, b) => a.name.localeCompare(b.name)),
    ),
  );
  const projects = $derived(
    dep($version, () =>
      api.ctx.index
        .all('project')
        .filter(
          (p) =>
            !p.archived &&
            (!customer || p.customer_id === customer) &&
            p.billing_model !== 'internal',
        ),
    ),
  );
  const entries = $derived.by(() => {
    void $version;
    return filterEntries(api.ctx, {
      customer_id: customer || null,
      project_id: project || null,
      from: from || null,
      to: to || null,
      statuses: statusFilter === 'open' ? ['unbilled', 'approved'] : ['approved'],
    }).filter((e) => e.billable);
  });
  const expenses = $derived(
    dep($version, () =>
      api.ctx.index
        .all('expense')
        .filter((x) => isExpenseBatchEligible(x) && (!customer || x.customer_id === customer)),
    ),
  );
  // Depends on the index version: approving entries changes their status without changing the selection.
  const approvedSelected = $derived(
    dep($version, () =>
      selected.filter((id) => api.ctx.index.get('time_entry', id)?.billing_status === 'approved'),
    ),
  );
  const fixedProjects = $derived(projects.filter((p) => p.billing_model === 'fixed_price'));
  const retainerProjects = $derived(projects.filter((p) => p.billing_model === 'retainer'));
  const discountBp = $derived(percentBpField(discount));
  const request = $derived<BatchRequest>({
    customer_id: customer || null,
    entry_ids: approvedSelected,
    expense_ids: expenseSel,
    include_fixed_price: fixed,
    retainer_months: Object.fromEntries(
      Object.entries(retainer)
        .map(([k, v]) => [k, Number(v) || 0])
        .filter(([, v]) => (v as number) > 0),
    ),
    discount_bp: discountBp.value ?? 0,
    period_from: from || null,
    period_to: to || null,
  });
  const preview = $derived.by(() => {
    void $version;
    if (
      !customer ||
      (!request.entry_ids.length &&
        !request.expense_ids.length &&
        !request.include_fixed_price.length &&
        !Object.keys(request.retainer_months).length)
    )
      return null;
    try {
      return { ok: true as const, value: previewBatch(api.ctx, request) };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  });
  const batches = $derived(
    dep($version, () =>
      api.ctx.index
        .all('billing_batch')
        .filter(
          (b) =>
            batchFilter === 'all' ||
            b.status === 'draft' ||
            b.status === 'exported' ||
            (b.status === 'invoiced' && b.paid_cents == null),
        )
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    ),
  );

  async function setStatus(to: 'approved' | 'unbilled' | 'written_off') {
    let reason = '';
    if (
      to === 'written_off' &&
      !(await api.confirm(
        t('billing.writeOff'),
        msg(
          `${selected.length} Einträge abschreiben? Sie werden nicht berechnet.`,
          `Write off ${selected.length} entries? They will not be billed.`,
        ),
      ))
    )
      return;
    if (to === 'written_off') reason = 'abgeschrieben';
    const r = await setBillingStatus(api.ctx, selected, to, reason);
    api.notify(
      `${r.ok.length} ✓${r.failed.length ? ` · ${r.failed.length} ✕ (${r.failed[0]!.error})` : ''}`,
      r.failed.length ? 'error' : 'success',
    );
    if (to !== 'approved') selected = [];
  }

  async function create() {
    const b = await api.run(() => createBatch(api.ctx, request), t('common.saved'));
    if (b) {
      selected = [];
      expenseSel = [];
      fixed = [];
      retainer = {};
      api.router.go({ name: 'batch', id: b.id });
    }
  }
</script>

<div class="lx-page">
  <div class="lx-toolbar">
    <h2>{t('nav.billing')}</h2>
    <select
      bind:value={customer}
      aria-label={t('project.customer')}
      onchange={() => {
        selected = [];
        expenseSel = [];
        fixed = [];
        project = '';
      }}
    >
      <option value="">{t('project.customer')}: {t('common.all')}</option>
      {#each customers as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
    </select>
    <select bind:value={project} aria-label={t('ticket.project')}>
      <option value="">{t('ticket.project')}: {t('common.all')}</option>
      {#each projects as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
    </select>
    <input type="date" bind:value={from} aria-label={t('common.from')} />
    <input type="date" bind:value={to} aria-label={t('common.to')} />
    <select bind:value={statusFilter} aria-label={t('common.status')}>
      <option value="open">{t('billing.status.unbilled')} + {t('billing.status.approved')}</option>
      <option value="approved">{t('billing.status.approved')}</option>
    </select>
  </div>

  <Section title={t('billing.unbilled')}>
    {#snippet actions()}
      <span class="lx-muted">{t('common.selected', { n: selected.length })}</span>
      <button type="button" disabled={!selected.length} onclick={() => setStatus('approved')}
        >{t('billing.approve')}</button
      >
      <button type="button" disabled={!selected.length} onclick={() => setStatus('unbilled')}
        >{t('billing.unapprove')}</button
      >
      <button type="button" disabled={!selected.length} onclick={() => setStatus('written_off')}
        >{t('billing.writeOff')}</button
      >
    {/snippet}
    <EntryTable {api} {entries} selectable bind:selected />
  </Section>

  <div class="lx-grid-2">
    <Section title={t('billing.createBatch')}>
      {#if !customer}
        <p class="lx-muted">{t('billing.selectCustomer')}</p>
      {:else}
        <p class="lx-small">
          {approvedSelected.length}
          {msg(
            'freigegebene Zeiteinträge ausgewählt',
            'approved time entries selected',
          )}{selected.length > approvedSelected.length
            ? msg(
                ` (${selected.length - approvedSelected.length} nicht freigegeben – werden ignoriert)`,
                ` (${selected.length - approvedSelected.length} not approved – ignored)`,
              )
            : ''}. {describeRounding(api.settings().rounding)}.
        </p>
        {#if expenses.length}
          <h4>{t('billing.expenses')}</h4>
          {#each expenses as x (x.id)}
            <label class="lx-check"
              ><input
                type="checkbox"
                checked={expenseSel.includes(x.id)}
                onchange={() =>
                  (expenseSel = expenseSel.includes(x.id)
                    ? expenseSel.filter((y) => y !== x.id)
                    : [...expenseSel, x.id])}
              />
              {x.date}
              {x.description} – {money(x.amount_cents)}</label
            >
          {/each}
        {/if}
        {#each fixedProjects as p (p.id)}
          <label class="lx-check"
            ><input
              type="checkbox"
              checked={fixed.includes(p.id)}
              onchange={() =>
                (fixed = fixed.includes(p.id) ? fixed.filter((y) => y !== p.id) : [...fixed, p.id])}
            />
            {t('billing.includeFixed')}: {p.name} ({money(p.fixed_price_cents)})</label
          >
        {/each}
        {#each retainerProjects as p (p.id)}
          <label class="lx-field"
            ><span class="lx-field-label"
              >{t('billing.retainerMonths')}: {p.name} ({money(p.retainer_monthly_fee_cents)}/{msg(
                'Monat',
                'month',
              )}, {dur(p.retainer_included_seconds)} h inkl.)</span
            >
            <input
              type="number"
              min="0"
              max="12"
              value={retainer[p.id] ?? ''}
              oninput={(e) =>
                (retainer = { ...retainer, [p.id]: (e.currentTarget as HTMLInputElement).value })}
            /></label
          >
        {/each}
        <label class="lx-field"
          ><span class="lx-field-label">{t('billing.discount')}</span><input
            type="text"
            bind:value={discount}
            inputmode="decimal"
          />{#if discountBp.error}<span class="lx-field-error">{discountBp.error}</span>{/if}</label
        >
        {#if preview}
          {#if preview.ok}
            <h4>{t('billing.preview')}</h4>
            <table class="lx-table lx-table-compact">
              <tbody>
                {#each preview.value.lines as l, i (i)}
                  <tr
                    ><td>{l.description}</td><td class="lx-num"
                      >{(l.quantity_milli / 1000).toLocaleString('de-DE', {
                        maximumFractionDigits: 3,
                      })}
                      {l.unit}</td
                    ><td class="lx-num">{money(l.unit_price_cents)}</td><td class="lx-num"
                      >{money(l.total_cents)}</td
                    ></tr
                  >
                {/each}
                <tr class="lx-total"
                  ><td colspan="3">{t('billing.net')}</td><td class="lx-num"
                    >{money(preview.value.netCents)}</td
                  ></tr
                >
              </tbody>
            </table>
            {#each preview.value.warnings as w (w)}<p class="lx-callout lx-tone-warn">{w}</p>{/each}
            <button type="button" class="mod-cta" onclick={create}
              >{t('billing.createBatch')}</button
            >
          {:else}
            <p class="lx-callout lx-tone-danger">{preview.error}</p>
          {/if}
        {/if}
      {/if}
    </Section>
    <Section title={t('billing.batches')}>
      {#snippet actions()}
        <select bind:value={batchFilter} aria-label={t('common.filter')}>
          <option value="active">{msg('Offen', 'Open')}</option>
          <option value="all">{t('common.all')}</option>
        </select>
      {/snippet}
      <ul class="lx-list">
        {#each batches as b (b.id)}
          <li>
            <button
              type="button"
              class="lx-link"
              onclick={() => api.router.go({ name: 'batch', id: b.id })}
              >{b.batch_number} · {api.ctx.index.get('customer', b.customer_id)?.name ??
                '—'}</button
            >
            <span
              ><StatusBadge prefix="batch.status" value={b.status} />
              {money(b.net_cents, b.currency)}
              <span class="lx-muted">{date(b.created_at)}</span></span
            >
          </li>
        {:else}<li class="lx-muted">—</li>{/each}
      </ul>
    </Section>
  </div>
</div>
