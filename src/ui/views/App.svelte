<script lang="ts">
  import { dep } from '../components/labels';
  import type { UiApi } from '../stores/ui-api';
  import type { RouteName } from '../navigation/router';
  import { LIST_OF } from '../navigation/router';
  import { t, type I18nKey } from '@/shared/i18n';
  import { searchEntities } from '@/application/queries/search';
  import { formatDuration } from '@/shared/date/time';
  import { sessionElapsedSeconds } from '@/domain/services/timer';
  import Dashboard from './Dashboard.svelte';
  import CustomerList from './CustomerList.svelte';
  import CustomerDetail from './CustomerDetail.svelte';
  import ProjectList from './ProjectList.svelte';
  import ProjectDetail from './ProjectDetail.svelte';
  import TicketsView from './TicketsView.svelte';
  import TicketDetail from './TicketDetail.svelte';
  import Timesheet from './Timesheet.svelte';
  import BillingView from './BillingView.svelte';
  import BatchDetail from './BatchDetail.svelte';
  import QuotesView from './QuotesView.svelte';
  import QuoteDetail from './QuoteDetail.svelte';
  import ExpensesView from './ExpensesView.svelte';
  import RecurringView from './RecurringView.svelte';
  import ServicesView from './ServicesView.svelte';
  import Analytics from './Analytics.svelte';
  import Health from './Health.svelte';
  import SettingsView from './SettingsView.svelte';

  let { api }: { api: UiApi } = $props();
  const route = api.router.route;
  const version = api.version;
  const timer = api.timer;
  const now = api.now;

  const NAV: { name: RouteName; key: I18nKey; icon: string; params?: Record<string, string> }[] = [
    { name: 'dashboard', key: 'nav.dashboard', icon: '◧' },
    { name: 'tickets', key: 'nav.tickets', icon: '▦' },
    { name: 'customers', key: 'nav.customers', icon: '◉' },
    { name: 'projects', key: 'nav.projects', icon: '▤' },
    { name: 'time', key: 'nav.time', icon: '◷' },
    { name: 'billing', key: 'nav.billing', icon: '€' },
    { name: 'quotes', key: 'nav.quotes', icon: '✎' },
    { name: 'expenses', key: 'nav.expenses', icon: '⊟' },
    { name: 'recurring', key: 'nav.recurring', icon: '↻' },
    { name: 'services', key: 'nav.services', icon: '⚙' },
    { name: 'analytics', key: 'nav.analytics', icon: '▥' },
    { name: 'health', key: 'nav.health', icon: '✚' },
    { name: 'settings', key: 'nav.settings', icon: '☰' },
  ];

  let query = $state('');
  let searchOpen = $state(false);
  let activeHit = $state(0);
  const hits = $derived(
    dep($version, () => (query.trim().length >= 2 ? searchEntities(api.ctx.index, query, 12) : [])),
  );
  const issueCount = $derived(
    dep($version, () => api.ctx.index.issues().filter((i) => i.severity === 'error').length),
  );
  const ROUTE_FOR = {
    customer: 'customer',
    project: 'project',
    ticket: 'ticket',
    billing_batch: 'batch',
    quote: 'quote',
    contact: 'customer',
    interaction: 'customer',
    expense: 'expenses',
    recurring_task: 'recurring',
    service: 'services',
    time_entry: 'time',
  } as const;

  function openHit(i: number) {
    const h = hits[i];
    if (!h) return;
    let id: string | undefined = h.id;
    if (h.type === 'contact') id = api.ctx.index.get('contact', h.id)?.customer_id;
    if (h.type === 'interaction') id = api.ctx.index.get('interaction', h.id)?.customer_id;
    const name = ROUTE_FOR[h.type];
    api.router.go(
      ['expenses', 'recurring', 'services', 'time'].includes(name) ? { name } : { name, id },
    );
    query = '';
    searchOpen = false;
  }

  function onSearchKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      activeHit = Math.min(activeHit + 1, hits.length - 1);
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      activeHit = Math.max(activeHit - 1, 0);
      e.preventDefault();
    } else if (e.key === 'Enter') {
      openHit(activeHit);
    } else if (e.key === 'Escape') {
      searchOpen = false;
      query = '';
    }
  }

  function isActive(n: (typeof NAV)[number]): boolean {
    const r = $route;
    const base = LIST_OF[r.name] ?? r.name;
    return n.name === base;
  }

  const crumbs = $derived.by(() => {
    void $version;
    const r = $route;
    const out: { text: string; go?: () => void }[] = [];
    const list = LIST_OF[r.name];
    const base = list ?? r.name;
    const navKey = NAV.find((n) => n.name === base)?.key ?? 'nav.dashboard';
    out.push({ text: t(navKey), go: list ? () => api.router.go({ name: list }) : undefined });
    if (r.id) {
      const idx = api.ctx.index;
      if (r.name === 'project' || r.name === 'ticket') {
        const p =
          r.name === 'project'
            ? idx.get('project', r.id)
            : idx.get('project', idx.get('ticket', r.id)?.project_id);
        const c = idx.get('customer', p?.customer_id);
        if (c)
          out.splice(
            0,
            1,
            { text: t('nav.customers'), go: () => api.router.go({ name: 'customers' }) },
            { text: c.name, go: () => api.router.go({ name: 'customer', id: c.id }) },
          );
        if (r.name === 'ticket' && p)
          out.push({ text: p.name, go: () => api.router.go({ name: 'project', id: p.id }) });
      }
      const rec = idx.record(r.id);
      if (rec) {
        const e = rec.entity;
        const text =
          'name' in e
            ? e.name
            : 'title' in e
              ? `${'ticket_number' in e ? e.ticket_number + ' ' : ''}${e.title}`
              : 'batch_number' in e
                ? e.batch_number
                : r.id;
        out.push({ text: String(text) });
      }
    }
    return out;
  });

  const canGoBack = $derived(dep($route, () => api.router.canGoBack));
  const timerLabel = $derived(
    $timer ? formatDuration(sessionElapsedSeconds($timer, $now), true) : '',
  );
</script>

<div class="lx-app">
  <nav class="lx-nav" aria-label={t('app.name')}>
    <div class="lx-brand">
      <span class="lx-brand-mark">L</span><span class="lx-brand-text">{t('app.short')}</span>
    </div>
    {#each NAV as n (n.key)}
      <button
        type="button"
        class="lx-nav-item"
        class:is-active={isActive(n)}
        onclick={() => api.router.go({ name: n.name, params: n.params })}
        title={t(n.key)}
      >
        <span class="lx-nav-icon" aria-hidden="true">{n.icon}</span><span class="lx-nav-label"
          >{t(n.key)}</span
        >
        {#if n.name === 'health' && issueCount > 0}<span class="lx-nav-count">{issueCount}</span
          >{/if}
      </button>
    {/each}
  </nav>

  <div class="lx-main">
    <header class="lx-topbar">
      <div class="lx-crumbs">
        {#if canGoBack}
          <button
            type="button"
            class="lx-icon-btn"
            onclick={() => api.router.back()}
            aria-label={t('common.back')}>←</button
          >
        {/if}
        {#each crumbs as c, i (i)}
          {#if i > 0}<span class="lx-crumb-sep">/</span>{/if}
          {#if c.go}<button type="button" class="lx-link" onclick={c.go}>{c.text}</button
            >{:else}<span class="lx-crumb-current">{c.text}</span>{/if}
        {/each}
      </div>
      <div class="lx-search">
        <input
          type="search"
          placeholder={t('search.placeholder')}
          bind:value={query}
          onfocus={() => (searchOpen = true)}
          onblur={() => setTimeout(() => (searchOpen = false), 150)}
          oninput={() => {
            searchOpen = true;
            activeHit = 0;
          }}
          onkeydown={onSearchKey}
          aria-label={t('nav.search')}
        />
        {#if searchOpen && query.trim().length >= 2}
          <ul class="lx-search-results" role="listbox">
            {#each hits as h, i (h.id)}
              <li role="option" aria-selected={i === activeHit}>
                <button
                  type="button"
                  class:is-active={i === activeHit}
                  onmousedown={() => openHit(i)}
                >
                  <span class="lx-hit-type">{h.type}</span>
                  <span class="lx-hit-title">{h.title}</span>
                  <span class="lx-muted">{h.subtitle}</span>
                </button>
              </li>
            {:else}
              <li class="lx-muted lx-pad">{t('search.empty')}</li>
            {/each}
          </ul>
        {/if}
      </div>
      <div class="lx-quick">
        {#if $timer}
          <button
            type="button"
            class="lx-timer-chip lx-state-{$timer.state}"
            onclick={() => api.openTimerPanel()}
            title={t('timer.title')}>◷ {timerLabel}</button
          >
        {/if}
        <button type="button" onclick={() => api.openForm({ kind: 'customer' })}
          >+ {t('quick.customer')}</button
        >
        <button type="button" onclick={() => api.openForm({ kind: 'project' })}
          >+ {t('quick.project')}</button
        >
        <button type="button" onclick={() => api.openForm({ kind: 'ticket' })}
          >+ {t('quick.ticket')}</button
        >
        <button type="button" class="mod-cta" onclick={() => api.openForm({ kind: 'time' })}
          >+ {t('quick.time')}</button
        >
      </div>
    </header>

    <div class="lx-content">
      {#key `${$route.name}:${$route.id ?? ''}:${JSON.stringify($route.params ?? {})}`}
        {#if $route.name === 'dashboard'}<Dashboard {api} />
        {:else if $route.name === 'customers'}<CustomerList {api} />
        {:else if $route.name === 'customer' && $route.id}<CustomerDetail {api} id={$route.id} />
        {:else if $route.name === 'projects'}<ProjectList {api} />
        {:else if $route.name === 'project' && $route.id}<ProjectDetail
            {api}
            id={$route.id}
            params={$route.params ?? {}}
          />
        {:else if $route.name === 'tickets'}<TicketsView {api} params={$route.params ?? {}} />
        {:else if $route.name === 'ticket' && $route.id}<TicketDetail {api} id={$route.id} />
        {:else if $route.name === 'time'}<Timesheet {api} />
        {:else if $route.name === 'billing'}<BillingView {api} />
        {:else if $route.name === 'batch' && $route.id}<BatchDetail {api} id={$route.id} />
        {:else if $route.name === 'quotes'}<QuotesView {api} />
        {:else if $route.name === 'quote' && $route.id}<QuoteDetail {api} id={$route.id} />
        {:else if $route.name === 'expenses'}<ExpensesView {api} />
        {:else if $route.name === 'recurring'}<RecurringView {api} />
        {:else if $route.name === 'services'}<ServicesView {api} />
        {:else if $route.name === 'analytics'}<Analytics {api} />
        {:else if $route.name === 'health'}<Health {api} />
        {:else if $route.name === 'settings'}<SettingsView {api} />
        {/if}
      {/key}
    </div>
  </div>
</div>
