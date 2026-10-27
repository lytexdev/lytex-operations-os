<script lang="ts">
  import { msg } from '@/shared/i18n';
  import { dep } from '../components/labels';
  import type { UiApi } from '../stores/ui-api';
  import { t } from '@/shared/i18n';
  import {
    activeEntries,
    entryValueCents,
    financeSummary,
    projectTotals,
    trackedSecondsByTicket,
    sumBy,
  } from '@/application/queries/aggregates';
  import { evaluateBudgets, profitability } from '@/domain/services/budget';
  import { isClosed } from '@/domain/policies/workflow';
  import {
    localDate,
    parseIso,
    addDays,
    startOfWeek,
    startOfMonth,
    type IsoDate,
  } from '@/shared/date/time';
  import { money, hours, pct, dur } from '../components/labels';
  import Section from '../components/Section.svelte';
  import Stat from '../components/Stat.svelte';
  import BarChart from '../components/BarChart.svelte';
  import HBars from '../components/HBars.svelte';
  import Progress from '../components/Progress.svelte';

  let { api }: { api: UiApi } = $props();
  const DEFINITIONS: [string, string][] = [
    [
      msg('Erfasste Zeit', 'Tracked time'),
      msg(
        'Alle nicht archivierten Zeiteinträge (abrechenbar und nicht abrechenbar).',
        'All non-archived time entries (billable and non-billable).',
      ),
    ],
    [
      msg('Abrechenbare Zeit', 'Billable time'),
      msg(
        'Einträge mit „abrechenbar“ und nicht abgeschrieben.',
        'Entries marked billable and not written off.',
      ),
    ],
    [
      msg('Freigegebene Zeit', 'Approved time'),
      msg(
        'Abrechenbare Einträge mit Status freigegeben, in Abrechnung oder abgerechnet.',
        'Billable entries that are approved, in billing or invoiced.',
      ),
    ],
    [
      msg('Abrechenbarer Wert', 'Billable value'),
      msg(
        'Dauer × gespeicherter Stundensatz, ohne Rundung (projizierter Umsatz).',
        'Duration × stored hourly rate, unrounded (projected revenue).',
      ),
    ],
    [
      msg('Abgerechnet', 'Invoiced'),
      msg(
        'Netto-Summe von Abrechnungsläufen mit bestätigter Rechnungsnummer (nach Rechnungsdatum).',
        'Net total of billing batches with a confirmed invoice number (by invoice date).',
      ),
    ],
    [
      msg('Bezahlt', 'Paid'),
      msg('Nur explizit erfasste Zahlungen.', 'Only explicitly recorded payments.'),
    ],
  ];
  const version = api.version;
  let tab = $state<'time' | 'finance' | 'projects'>('time');
  const today = localDate(Date.now());
  let from = $state<IsoDate>(addDays(today, -89));
  let to = $state<IsoDate>(today);
  let customer = $state('');

  const customers = $derived(
    dep($version, () => api.ctx.index.all('customer').sort((a, b) => a.name.localeCompare(b.name))),
  );

  const d = $derived.by(() => {
    void $version;
    const idx = api.ctx.index;
    const entries = activeEntries(idx).filter((e) => {
      if (e.source === 'adjustment') return false;
      const day = localDate(parseIso(e.started_at));
      return day >= from && day <= to && (!customer || e.customer_id === customer);
    });
    const tracked = entries.reduce((a, e) => a + e.duration_seconds, 0);
    const billable = entries
      .filter((e) => e.billable && e.billing_status !== 'written_off')
      .reduce((a, e) => a + e.duration_seconds, 0);
    const approved = entries
      .filter(
        (e) =>
          e.billable && ['approved', 'reserved', 'invoiced', 'adjusted'].includes(e.billing_status),
      )
      .reduce((a, e) => a + e.duration_seconds, 0);
    const value = entries.reduce(
      (a, e) => a + (e.billing_status === 'written_off' ? 0 : entryValueCents(e)),
      0,
    );
    const byDay = new Map<string, number>();
    const byWeek = new Map<string, number>();
    const byMonth = new Map<string, number>();
    for (const e of entries) {
      const day = localDate(parseIso(e.started_at));
      byDay.set(day, (byDay.get(day) ?? 0) + e.duration_seconds);
      byWeek.set(startOfWeek(day), (byWeek.get(startOfWeek(day)) ?? 0) + e.duration_seconds);
      byMonth.set(startOfMonth(day), (byMonth.get(startOfMonth(day)) ?? 0) + e.duration_seconds);
    }
    const days: { label: string; value: number }[] = [];
    for (let x = from; x <= to && days.length < 400; x = addDays(x, 1))
      days.push({ label: x.slice(5), value: byDay.get(x) ?? 0 });
    const perCustomer = sumBy(
      entries,
      (e) => e.customer_id,
      (e) => e.duration_seconds,
    );
    const perProject = sumBy(
      entries,
      (e) => e.project_id,
      (e) => e.duration_seconds,
    );
    const perTicket = sumBy(
      entries.filter((e) => e.ticket_id),
      (e) => e.ticket_id,
      (e) => e.duration_seconds,
    );
    const revCustomer = sumBy(
      entries,
      (e) => e.customer_id,
      (e) => (e.billing_status === 'written_off' ? 0 : entryValueCents(e)),
    );
    const revService = sumBy(
      entries,
      (e) =>
        e.service_id ??
        idx.get('ticket', e.ticket_id)?.service_id ??
        idx.get('project', e.project_id)?.service_id ??
        null,
      (e) => (e.billing_status === 'written_off' ? 0 : entryValueCents(e)),
    );
    const batches = idx
      .all('billing_batch')
      .filter(
        (b) =>
          b.status === 'invoiced' &&
          (!customer || b.customer_id === customer) &&
          (b.invoice_date ?? '') >= from &&
          (b.invoice_date ?? '') <= to,
      );
    const invoiced = batches.reduce((a, b) => a + b.net_cents, 0);
    const paid = batches.reduce((a, b) => a + (b.paid_cents ?? 0), 0);
    const s = api.settings();
    const projects = idx
      .all('project')
      .filter((p) => !p.archived && (!customer || p.customer_id === customer));
    const trackedByTicket = trackedSecondsByTicket(idx);
    const projRows = projects.map((p) => {
      const totals = projectTotals(idx, p.id);
      const tickets = idx.all('ticket').filter((tk) => tk.project_id === p.id && !tk.archived);
      const done = tickets.filter((tk) => isClosed(s.workflow, tk.status));
      const overdue = tickets.filter(
        (tk) => tk.due_date && tk.due_date < today && !isClosed(s.workflow, tk.status),
      );
      const openEstimate = tickets
        .filter((tk) => !isClosed(s.workflow, tk.status))
        .reduce(
          (a, tk) =>
            a + Math.max(0, (tk.estimated_seconds ?? 0) - (trackedByTicket.get(tk.id) ?? 0)),
          0,
        );
      return {
        p,
        totals,
        budgets: evaluateBudgets(p, totals, s.budgetThresholds),
        profit: profitability(p, totals, s.internalCostRateCents),
        tickets: tickets.length,
        done: done.length,
        overdue: overdue.length,
        openEstimate,
      };
    });
    return {
      tracked,
      billable,
      approved,
      value,
      days,
      weeks: [...byWeek.entries()].sort().map(([k, v]) => ({ label: k.slice(5), value: v })),
      months: [...byMonth.entries()].sort().map(([k, v]) => ({ label: k.slice(0, 7), value: v })),
      perCustomer: [...perCustomer.entries()].map(([id, v]) => ({
        id,
        label: idx.get('customer', id)?.name ?? t('common.internal'),
        value: v,
      })),
      perProject: [...perProject.entries()].map(([id, v]) => ({
        id,
        label: idx.get('project', id)?.name ?? id,
        value: v,
      })),
      perTicket: [...perTicket.entries()].map(([id, v]) => ({
        id,
        label: (() => {
          const tk = idx.get('ticket', id);
          return tk ? `${tk.ticket_number} ${tk.title}` : id;
        })(),
        value: v,
      })),
      revCustomer: [...revCustomer.entries()]
        .filter(([, v]) => v > 0)
        .map(([id, v]) => ({ id, label: idx.get('customer', id)?.name ?? '—', value: v })),
      revService: [...revService.entries()]
        .filter(([, v]) => v > 0)
        .map(([id, v]) => ({
          label: idx.get('service', id)?.name ?? msg('Ohne Leistung', 'No service'),
          value: v,
        })),
      fin: financeSummary(idx),
      invoiced,
      paid,
      projRows,
    };
  });
</script>

<div class="lx-page">
  <div class="lx-toolbar">
    <h2>{t('nav.analytics')}</h2>
    <div class="lx-segmented" role="tablist">
      <button type="button" class:is-active={tab === 'time'} onclick={() => (tab = 'time')}
        >{t('analytics.time')}</button
      >
      <button type="button" class:is-active={tab === 'finance'} onclick={() => (tab = 'finance')}
        >{t('analytics.finance')}</button
      >
      <button type="button" class:is-active={tab === 'projects'} onclick={() => (tab = 'projects')}
        >{t('analytics.projects')}</button
      >
    </div>
    <input type="date" bind:value={from} aria-label={t('common.from')} />
    <input type="date" bind:value={to} aria-label={t('common.to')} />
    <select bind:value={customer} aria-label={t('project.customer')}>
      <option value="">{t('project.customer')}: {t('common.all')}</option>
      {#each customers as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
    </select>
  </div>

  {#if tab === 'time'}
    <div class="lx-stats">
      <Stat label={msg('Erfasste Zeit', 'Tracked time')} value={dur(d.tracked)} />
      <Stat label={msg('Abrechenbare Zeit', 'Billable time')} value={dur(d.billable)} />
      <Stat label={msg('Freigegebene Zeit', 'Approved time')} value={dur(d.approved)} />
      <Stat
        label={t('analytics.utilization')}
        value={d.tracked ? pct(d.billable / d.tracked) : '—'}
        tone="brand"
      />
    </div>
    <Section title={t('analytics.daily')}
      ><BarChart items={d.days} format={(v) => `${hours(v)} h`} /></Section
    >
    <div class="lx-grid-2">
      <Section title={t('analytics.weekly')}
        ><BarChart items={d.weeks} format={(v) => `${hours(v)} h`} /></Section
      >
      <Section title={t('analytics.monthly')}
        ><BarChart items={d.months} format={(v) => `${hours(v)} h`} /></Section
      >
      <Section title={t('analytics.perCustomer')}
        ><HBars
          items={d.perCustomer}
          format={(v) => `${hours(v)} h`}
          onselect={(id) => api.router.go({ name: 'customer', id })}
        /></Section
      >
      <Section title={t('analytics.perProject')}
        ><HBars
          items={d.perProject}
          format={(v) => `${hours(v)} h`}
          onselect={(id) => api.router.go({ name: 'project', id })}
        /></Section
      >
      <Section title={t('analytics.perTicket')}
        ><HBars
          items={d.perTicket}
          format={(v) => `${hours(v)} h`}
          onselect={(id) => api.router.go({ name: 'ticket', id })}
        /></Section
      >
    </div>
  {:else if tab === 'finance'}
    <div class="lx-stats">
      <Stat
        label={msg('Abrechenbarer Wert (Zeitraum)', 'Billable value (period)')}
        value={money(d.value)}
      />
      <Stat
        label={msg('Nicht abgerechnet (gesamt)', 'Unbilled (total)')}
        value={money(d.fin.unbilledValueCents)}
        hint={`${msg('davon freigegeben', 'approved')}: ${money(d.fin.approvedValueCents)}`}
      />
      <Stat label={msg('In Abrechnung', 'In billing')} value={money(d.fin.reservedValueCents)} />
      <Stat
        label={msg('Abgerechnet (Zeitraum)', 'Invoiced (period)')}
        value={money(d.invoiced)}
        tone="brand"
      />
      <Stat
        label={msg('Bezahlt (Zeitraum, erfasst)', 'Paid (period, recorded)')}
        value={money(d.paid)}
        tone="ok"
      />
      <Stat
        label={msg('Effektiver Stundenerlös', 'Effective hourly revenue')}
        value={d.tracked ? money(Math.round((d.value * 3600) / d.tracked)) : '—'}
        hint={msg('abrechenbarer Wert / erfasste Zeit', 'billable value / tracked time')}
      />
    </div>
    <div class="lx-grid-2">
      <Section title={t('analytics.revenueCustomer')}
        ><HBars
          items={d.revCustomer}
          format={(v) => money(v)}
          onselect={(id) => api.router.go({ name: 'customer', id })}
        /></Section
      >
      <Section title={t('analytics.revenueService')}
        ><HBars items={d.revService} format={(v) => money(v)} /></Section
      >
      <Section title={t('project.profit')}>
        <table class="lx-table lx-table-compact">
          <thead
            ><tr
              ><th>{t('ticket.project')}</th><th class="lx-num">{t('project.revenue')}</th><th
                class="lx-num">{t('project.cost')}</th
              ><th class="lx-num">{t('project.margin')}</th><th class="lx-num">€/h</th></tr
            ></thead
          >
          <tbody>
            {#each d.projRows.filter((r) => r.p.billing_model !== 'internal') as r (r.p.id)}
              <tr
                ><td
                  ><button
                    type="button"
                    class="lx-link"
                    onclick={() => api.router.go({ name: 'project', id: r.p.id })}
                    >{r.p.name}</button
                  >{#if r.p.billing_model === 'fixed_price'}<span class="lx-badge">FP</span
                    >{/if}</td
                ><td class="lx-num">{money(r.profit.revenueCents)}</td><td class="lx-num"
                  >{money(r.profit.internalCostCents)}</td
                ><td class="lx-num" class:lx-danger={r.profit.marginCents < 0}
                  >{money(r.profit.marginCents)}</td
                ><td class="lx-num"
                  >{r.profit.effectiveHourlyCents != null
                    ? money(r.profit.effectiveHourlyCents)
                    : '—'}</td
                ></tr
              >
            {/each}
          </tbody>
        </table>
      </Section>
      <Section title={t('analytics.definitions')}>
        <dl class="lx-dl lx-small">
          {#each DEFINITIONS as [term, definition] (term)}
            <dt>{term}</dt>
            <dd>{definition}</dd>
          {/each}
        </dl>
      </Section>
    </div>
  {:else}
    <table class="lx-table">
      <thead
        ><tr
          ><th>{t('ticket.project')}</th><th class="lx-num">{t('ticket.tracked')}</th><th
            >{t('project.budgets')}</th
          ><th class="lx-num">{t('analytics.completion')}</th><th class="lx-num"
            >{t('dash.overdue')}</th
          ><th class="lx-num">{t('analytics.workload')}</th></tr
        ></thead
      >
      <tbody>
        {#each d.projRows as r (r.p.id)}
          <tr>
            <td
              ><button
                type="button"
                class="lx-link"
                onclick={() => api.router.go({ name: 'project', id: r.p.id })}>{r.p.name}</button
              ></td
            >
            <td class="lx-num">{dur(r.totals.trackedSeconds)}</td>
            <td
              >{#each r.budgets as b (b.kind)}<Progress
                  ratio={b.ratio}
                  label={b.label}
                  detail=""
                />{:else}<span class="lx-muted">—</span>{/each}</td
            >
            <td class="lx-num">{r.done}/{r.tickets}</td>
            <td class="lx-num" class:lx-danger={r.overdue > 0}>{r.overdue}</td>
            <td class="lx-num">{dur(r.openEstimate)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>
