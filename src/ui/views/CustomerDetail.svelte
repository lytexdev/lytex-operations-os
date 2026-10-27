<script lang="ts">
  import { msg } from '@/shared/i18n';
  import { confirmDelete } from '../components/delete';
  import { dep } from '../components/labels';
  import type { UiApi } from '../stores/ui-api';
  import { t } from '@/shared/i18n';
  import { customerProjects, entryValueCents } from '@/application/queries/aggregates';
  import { customerTimeline } from '@/application/queries/timeline';
  import { money, dur, date, dateTime, label } from '../components/labels';
  import { isClosed } from '@/domain/policies/workflow';
  import Section from '../components/Section.svelte';
  import Stat from '../components/Stat.svelte';
  import StatusBadge from '../components/StatusBadge.svelte';
  import Empty from '../components/Empty.svelte';

  let { api, id }: { api: UiApi; id: string } = $props();
  const version = api.version;
  const c = $derived(dep($version, () => api.ctx.index.get('customer', id)));

  const data = $derived.by(() => {
    void $version;
    const idx = api.ctx.index;
    const wf = api.settings().workflow;
    const entries = idx.all('time_entry').filter((e) => e.customer_id === id && !e.archived);
    const stats = { tracked: 0, billable: 0, unbilled: 0, invoiced: 0, paid: 0 };
    for (const e of entries) {
      stats.tracked += e.duration_seconds;
      if (e.billable && e.billing_status !== 'written_off') {
        stats.billable += e.duration_seconds;
        if (e.billing_status === 'unbilled' || e.billing_status === 'approved')
          stats.unbilled += entryValueCents(e);
      }
    }
    const batches = idx
      .all('billing_batch')
      .filter((b) => b.customer_id === id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    for (const b of batches)
      if (b.status === 'invoiced') {
        stats.invoiced += b.net_cents;
        stats.paid += b.paid_cents ?? 0;
      }
    return {
      contacts: idx
        .all('contact')
        .filter((x) => x.customer_id === id && !x.archived)
        .sort((a, b) => Number(b.primary) - Number(a.primary)),
      projects: customerProjects(idx, id).sort(
        (a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name),
      ),
      tickets: idx
        .all('ticket')
        .filter((tk) => tk.customer_id === id && !tk.archived && !isClosed(wf, tk.status))
        .slice(0, 20),
      entries: entries.sort((a, b) => b.started_at.localeCompare(a.started_at)).slice(0, 15),
      quotes: idx.all('quote').filter((q) => q.customer_id === id),
      batches,
      interactions: idx
        .all('interaction')
        .filter((i) => i.customer_id === id)
        .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
        .slice(0, 10),
      timeline: customerTimeline(idx, id, 20),
      stats,
    };
  });
</script>

{#if !c}
  <Empty text={msg('Kunde nicht gefunden.', 'Customer not found.')} />
{:else}
  <div class="lx-page">
    <div class="lx-detail-head">
      <div>
        <h2>{c.name} <StatusBadge prefix="customer.status" value={c.status} /></h2>
        <div class="lx-muted">
          {c.customer_number} · {label('customer.kind', c.customer_kind)}{c.address.city
            ? ` · ${c.address.city}`
            : ''}
        </div>
      </div>
      <div class="lx-actions">
        <button type="button" onclick={() => api.openForm({ kind: 'customer', id: c.id })}
          >{t('common.edit')}</button
        >
        <button type="button" onclick={() => api.openNote(c.id)}>{t('common.openNote')}</button>
        <button
          type="button"
          onclick={() =>
            api.run(() => api.ctx.repo.archive('customer', c.id, !c.archived), t('common.saved'))}
          >{c.archived ? t('common.unarchive') : t('common.archive')}</button
        >
        <button
          type="button"
          class="mod-warning"
          onclick={async () => {
            if (await confirmDelete(api, 'customer', c.id, c.name))
              api.router.go({ name: 'customers' });
          }}>{t('common.delete')}</button
        >
        <button
          type="button"
          class="mod-cta"
          onclick={() => api.openForm({ kind: 'project', preset: { customer_id: c.id } })}
          >{t('project.new')}</button
        >
      </div>
    </div>

    <div class="lx-stats">
      <Stat
        label={t('ticket.tracked')}
        value={dur(data.stats.tracked)}
        hint="{t('dash.billable')}: {dur(data.stats.billable)}"
      />
      <Stat
        label={t('dash.unbilledValue')}
        value={money(data.stats.unbilled)}
        tone="brand"
        onclick={() => api.router.go({ name: 'billing', params: { customer: c.id } })}
      />
      <Stat
        label={t('billing.status.invoiced')}
        value={money(data.stats.invoiced)}
        hint={`${msg('Bezahlt (erfasst)', 'Paid (recorded)')}: ${money(data.stats.paid)}`}
      />
      <Stat
        label={t('customer.rate')}
        value={c.default_rate_cents != null
          ? money(c.default_rate_cents)
          : `${money(api.settings().defaultHourlyRateCents)} (Standard)`}
        hint="{t('customer.paymentTerms')}: {c.payment_terms_days}"
      />
    </div>

    <div class="lx-grid-2">
      <Section title={t('customer.contacts')}>
        {#snippet actions()}<button
            type="button"
            onclick={() => api.openForm({ kind: 'contact', preset: { customer_id: c.id } })}
            >+</button
          >{/snippet}
        <ul class="lx-list">
          {#each data.contacts as p (p.id)}
            <li>
              <button
                type="button"
                class="lx-link"
                onclick={() => api.openForm({ kind: 'contact', id: p.id })}
                >{p.first_name} {p.last_name}</button
              >
              <span class="lx-muted">{p.role}{p.primary ? ' · ★' : ''} {p.email} {p.phone}</span>
            </li>
          {:else}<li class="lx-muted">—</li>{/each}
        </ul>
      </Section>
      <Section title={t('common.description')}>
        <dl class="lx-dl">
          <dt>{t('customer.email')}</dt>
          <dd>{c.email || '—'}</dd>
          <dt>{t('customer.phone')}</dt>
          <dd>{c.phone || '—'}</dd>
          <dt>{t('customer.website')}</dt>
          <dd>{c.website || '—'}</dd>
          <dt>{t('customer.address')}</dt>
          <dd>
            {[c.address.street, `${c.address.zip} ${c.address.city}`.trim(), c.address.country]
              .filter(Boolean)
              .join(', ') || '—'}
          </dd>
          {#if c.billing_address}<dt>{t('customer.billingAddress')}</dt>
            <dd>
              {[
                c.billing_address.street,
                `${c.billing_address.zip} ${c.billing_address.city}`.trim(),
              ]
                .filter(Boolean)
                .join(', ')}
            </dd>{/if}
          <dt>{t('customer.vatId')}</dt>
          <dd>{c.vat_id || '—'}</dd>
          <dt>{t('customer.passwordRef')}</dt>
          <dd>{c.password_manager_ref || '—'}</dd>
        </dl>
      </Section>
      <Section title={t('nav.projects')}>
        <ul class="lx-list">
          {#each data.projects as p (p.id)}
            <li class:is-archived={p.archived}>
              <button
                type="button"
                class="lx-link"
                onclick={() => api.router.go({ name: 'project', id: p.id })}
                >{p.project_number} {p.name}</button
              >
              <StatusBadge prefix="project.status" value={p.status} />
            </li>
          {:else}<li class="lx-muted">—</li>{/each}
        </ul>
      </Section>
      <Section title={t('dash.openTickets')}>
        <ul class="lx-list">
          {#each data.tickets as tk (tk.id)}
            <li>
              <button
                type="button"
                class="lx-link"
                onclick={() => api.router.go({ name: 'ticket', id: tk.id })}
                >{tk.ticket_number} {tk.title}</button
              ><span class="lx-muted">{date(tk.due_date)}</span>
            </li>
          {:else}<li class="lx-muted">—</li>{/each}
        </ul>
      </Section>
      <Section title={t('customer.interactions')}>
        {#snippet actions()}<button
            type="button"
            onclick={() => api.openForm({ kind: 'interaction', preset: { customer_id: c.id } })}
            >+</button
          >{/snippet}
        <ul class="lx-list">
          {#each data.interactions as i (i.id)}
            <li>
              <button type="button" class="lx-link" onclick={() => api.openNote(i.id)}
                >{label('interaction.kind', i.kind)}: {i.subject}</button
              ><span class="lx-muted"
                >{dateTime(i.occurred_at)}{i.follow_up_date
                  ? ` · ↻ ${date(i.follow_up_date)}`
                  : ''}</span
              >
            </li>
          {:else}<li class="lx-muted">—</li>{/each}
        </ul>
      </Section>
      <Section title={t('customer.stats')}>
        <ul class="lx-list">
          {#each data.batches as b (b.id)}
            <li>
              <button
                type="button"
                class="lx-link"
                onclick={() => api.router.go({ name: 'batch', id: b.id })}>{b.batch_number}</button
              ><span
                ><StatusBadge prefix="batch.status" value={b.status} />
                {money(b.net_cents, b.currency)}</span
              >
            </li>
          {/each}
          {#each data.quotes as q (q.id)}
            <li>
              <button
                type="button"
                class="lx-link"
                onclick={() => api.router.go({ name: 'quote', id: q.id })}
                >{q.quote_number} {q.title}</button
              ><StatusBadge prefix="quote.status" value={q.status} />
            </li>
          {/each}
          {#if !data.batches.length && !data.quotes.length}<li class="lx-muted">—</li>{/if}
        </ul>
      </Section>
      <Section title={t('nav.time')}>
        <ul class="lx-list">
          {#each data.entries as e (e.id)}
            <li>
              <span>{date(e.started_at)} · {e.description || '—'}</span><span class="lx-muted"
                >{dur(e.duration_seconds)} · {label('billing.status', e.billing_status)}</span
              >
            </li>
          {:else}<li class="lx-muted">—</li>{/each}
        </ul>
      </Section>
      <Section title={t('customer.timeline')}>
        <ul class="lx-list lx-timeline">
          {#each data.timeline as it, i (i)}
            <li><span>{it.text}</span><span class="lx-muted">{dateTime(it.at)}</span></li>
          {:else}<li class="lx-muted">—</li>{/each}
        </ul>
      </Section>
    </div>
  </div>
{/if}
