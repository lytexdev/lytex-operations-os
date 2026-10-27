import { describe, it, expect } from 'vitest';
import { Router } from '@/ui/navigation/router';
import { get } from 'svelte/store';
import {
  moneyField,
  durationField,
  dateTimeField,
  emailField,
  urlField,
  percentBpField,
  quantityMilliField,
  FormErrors,
  hoursField,
} from '@/ui/forms/form-utils';
import { makeEnv, seedBasic } from '../helpers/fixtures';
import { filterTickets } from '@/application/queries/tickets';
import { searchEntities } from '@/application/queries/search';
import { createTicket, changeTicketStatus } from '@/application/use-cases/tickets';

describe('router', () => {
  it('navigates with back history and ignores duplicate routes', () => {
    const r = new Router();
    expect(get(r.route).name).toBe('dashboard');
    r.go({ name: 'customers' });
    r.go({ name: 'customer', id: 'CUS-1' });
    r.go({ name: 'customer', id: 'CUS-1' });
    expect(r.canGoBack).toBe(true);
    r.back();
    expect(get(r.route).name).toBe('customers');
    r.back();
    expect(get(r.route).name).toBe('dashboard');
    expect(r.canGoBack).toBe(false);
  });
});

describe('form validation', () => {
  it('money', () => {
    expect(moneyField('70,50').value).toBe(7050);
    expect(moneyField('', { required: true }).error).toMatch(/erforderlich/);
    expect(moneyField('abc').error).toMatch(/Ungültig/);
    expect(moneyField('-5', { min: 0 }).error).toMatch(/mindestens/);
    expect(moneyField('').value).toBeNull();
  });
  it('durations and hours', () => {
    expect(durationField('1:30').value).toBe(5400);
    expect(durationField('-0:30', { allowNegative: true }).value).toBe(-1800);
    expect(durationField('x').error).toBeDefined();
    expect(hoursField('10').value).toBe(36000);
    expect(hoursField('1,5').value).toBe(5400);
  });
  it('dates, email, url, percent, quantity', () => {
    expect(dateTimeField('2026-02-30', '10:00').error).toBeDefined();
    expect(dateTimeField('2026-10-23', '25:00').error).toBeDefined();
    expect(emailField('a@b').error).toBeDefined();
    expect(emailField('a@b.de').value).toBe('a@b.de');
    expect(urlField('example.com').value).toBe('https://example.com');
    expect(urlField('nope').error).toBeDefined();
    expect(percentBpField('12,5').value).toBe(1250);
    expect(percentBpField('101').error).toBeDefined();
    expect(quantityMilliField('1,5').value).toBe(1500);
  });
  it('FormErrors collects field errors', () => {
    const f = new FormErrors();
    f.require('name', '  ');
    f.take('rate', moneyField('x'));
    expect(f.ok).toBe(false);
    expect(Object.keys(f.errors)).toEqual(['name', 'rate']);
  });
});

describe('ticket filters & search', () => {
  it('presets: mine, overdue, dueSoon, completed', async () => {
    const env = await makeEnv();
    const { project, ticket } = await seedBasic(env);
    const base = { ...ticket, id: undefined, project_id: project.id } as never;
    const overdue = await createTicket(env.core.ctx, {
      ...(base as object),
      title: 'Alt',
      due_date: '2026-10-01',
      status: 'backlog',
    } as never);
    const soon = await createTicket(env.core.ctx, {
      ...(base as object),
      title: 'Bald',
      due_date: '2026-10-25',
      status: 'backlog',
    } as never);
    const done = await createTicket(env.core.ctx, {
      ...(base as object),
      title: 'Fertig',
      status: 'backlog',
    } as never);
    await changeTicketStatus(env.core.ctx, done.id, 'done');
    const f = (preset: Parameters<typeof filterTickets>[2]['preset']) =>
      filterTickets(
        env.core.index,
        env.settings.workflow,
        { preset },
        '2026-10-23',
        'Alex Beispiel',
        7,
      ).map((t) => t.title);
    expect(f('overdue')).toEqual([overdue.title]);
    expect(f('dueSoon')).toEqual([soon.title]);
    expect(f('completed')).toEqual([done.title]);
    expect(f('mine')).toEqual(expect.arrayContaining([ticket.title, overdue.title, soon.title]));
    expect(f('all')).not.toContain(done.title);
    expect(
      filterTickets(
        env.core.index,
        env.settings.workflow,
        { preset: 'everything', text: 'bald' },
        '2026-10-23',
        'Alex Beispiel',
        7,
      ),
    ).toHaveLength(1);
  });
  it('cross-entity search ranks titles and ignores archived', async () => {
    const env = await makeEnv();
    const { customer } = await seedBasic(env);
    expect(searchEntities(env.core.index, 'muster')[0]!.id).toBe(customer.id);
    expect(searchEntities(env.core.index, 'startseite')[0]!.type).toBe('ticket');
    await env.core.repo.archive('customer', customer.id);
    expect(
      searchEntities(env.core.index, 'muster').find((h) => h.id === customer.id),
    ).toBeUndefined();
    expect(searchEntities(env.core.index, 'x')).toEqual(expect.any(Array));
  });
});
