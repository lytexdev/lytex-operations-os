// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import TimerPanel from '@/ui/views/TimerPanel.svelte';
import Dashboard from '@/ui/views/Dashboard.svelte';
import CustomerList from '@/ui/views/CustomerList.svelte';
import Empty from '@/ui/components/Empty.svelte';
import Progress from '@/ui/components/Progress.svelte';
import ProjectForm from '@/ui/forms/ProjectForm.svelte';
import { makeEnv, seedBasic } from '../helpers/fixtures';
import { makeUiApi } from '../helpers/ui-api';

const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await tick();
  }
};

afterEach(() => cleanup());

describe('components', () => {
  it('Empty state renders text', () => {
    render(Empty, { text: 'Nichts da' });
    expect(screen.getByText('Nichts da')).toBeTruthy();
  });

  it('Progress clamps and exposes aria values', () => {
    const { container } = render(Progress, { ratio: 1.7, label: 'Budget' });
    const bar = container.querySelector('[role=progressbar]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('100');
    expect(container.querySelector('.lx-tone-danger')).toBeTruthy();
  });

  it('Dashboard shows empty state without data and real numbers with data', async () => {
    const env = await makeEnv();
    const { api } = makeUiApi(env);
    const first = render(Dashboard, { api });
    expect(first.container.textContent).toContain('Noch keine Daten');
    first.unmount();
    await seedBasic(env);
    const second = render(Dashboard, { api });
    await flush();
    expect(second.container.textContent).not.toContain('Noch keine Daten');
    expect(second.container.textContent).toContain('Offene Tickets');
  });

  it('CustomerList filters by search text', async () => {
    const env = await makeEnv();
    await seedBasic(env);
    const { api } = makeUiApi(env);
    const { container } = render(CustomerList, { api });
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
    const input = container.querySelector('input[type=search]') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'gibtsnicht' } });
    await flush();
    expect(container.textContent).toContain('Noch keine Kunden');
  });
});

describe('TimerPanel controls', () => {
  it('requires a project, then start → pause → resume → stop creates one entry', async () => {
    const env = await makeEnv();
    const { project } = await seedBasic(env);
    const { api, log } = makeUiApi(env);
    const { container } = render(TimerPanel, { api });
    const btn = (label: string) =>
      [...container.querySelectorAll('button')].find((b) =>
        b.textContent?.includes(label),
      ) as HTMLButtonElement;

    await fireEvent.click(btn('Starten'));
    expect(log.notices.at(-1)?.kind).toBe('error');
    expect(env.core.timer.stateName).toBe('idle');

    const select = container.querySelector('select') as HTMLSelectElement;
    select.value = project.id;
    await fireEvent.change(select);
    await fireEvent.click(btn('Starten'));
    await flush();
    expect(env.core.timer.stateName).toBe('running');

    env.clock.advance(30 * 60_000);
    await fireEvent.click(btn('Pause'));
    await flush();
    expect(env.core.timer.stateName).toBe('paused');
    await fireEvent.click(btn('Fortsetzen'));
    await flush();
    expect(env.core.timer.stateName).toBe('running');
    env.clock.advance(15 * 60_000);
    await fireEvent.click(btn('Stoppen'));
    await flush();
    expect(env.core.timer.stateName).toBe('idle');
    const entries = env.core.index.all('time_entry');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.duration_seconds).toBe(45 * 60);
  });

  it('discard asks for confirmation and keeps the timer when declined', async () => {
    const env = await makeEnv();
    const { project } = await seedBasic(env);
    const { api, log } = makeUiApi(env, { confirm: false });
    await env.core.timer.start({
      project_id: project.id,
      ticket_id: null,
      customer_id: null,
      service_id: null,
      description: '',
      billable: true,
    });
    const { container } = render(TimerPanel, { api });
    await flush();
    const discard = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Verwerfen'),
    )!;
    await fireEvent.click(discard);
    await flush();
    expect(log.confirms).toHaveLength(1);
    expect(env.core.timer.stateName).toBe('running');
  });
});

describe('ProjectForm', () => {
  const fill = async (el: HTMLInputElement | HTMLSelectElement, value: string) => {
    el.value = value;
    await fireEvent.input(el);
    await fireEvent.change(el);
  };
  const click = async (container: HTMLElement, label: string) => {
    const b = [...container.querySelectorAll('button')].find(
      (x) => x.textContent?.trim() === label,
    );
    if (!b) throw new Error(`button ${label} not found`);
    await fireEvent.click(b);
    await flush();
  };

  it('"Intern (LYTEX)" creates an internal project without customer', async () => {
    const env = await makeEnv();
    const { api, log } = makeUiApi(env);
    let closed = false;
    const { container } = render(ProjectForm, { api, preset: {}, close: () => (closed = true) });
    await fill(container.querySelector('input[type=text]') as HTMLInputElement, 'Website LYTEX');
    await click(container, 'Weiter');
    const radios = [...container.querySelectorAll('input[type=radio]')] as HTMLInputElement[];
    expect(radios.find((r) => r.value === 'internal')!.checked).toBe(true);
    expect(radios.find((r) => r.value === 'time_and_materials')!.disabled).toBe(true);
    await click(container, 'Weiter');
    await click(container, 'Anlegen');
    expect(log.notices.filter((n) => n.kind === 'error')).toEqual([]);
    const p = env.core.index.all('project')[0]!;
    expect(p.customer_id).toBeNull();
    expect(p.billing_model).toBe('internal');
    expect(closed).toBe(true);
  });

  it('choosing a customer again restores time & materials', async () => {
    const env = await makeEnv();
    const { customer } = await seedBasic(env);
    const { api } = makeUiApi(env);
    const { container } = render(ProjectForm, { api, preset: {}, close: () => undefined });
    await fill(container.querySelector('input[type=text]') as HTMLInputElement, 'Zweitprojekt');
    await fill(container.querySelector('select') as HTMLSelectElement, customer.id);
    await click(container, 'Weiter');
    const checked = (container.querySelector('input[type=radio]:checked') as HTMLInputElement)
      .value;
    expect(checked).toBe('time_and_materials');
  });
});
