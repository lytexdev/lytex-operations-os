import { describe, it, expect } from 'vitest';
import {
  amountForSeconds,
  divRoundHalfUp,
  formatMoney,
  parseMoney,
  lineTotal,
  centsToDecimalString,
} from '@/shared/money/money';
import {
  addMonths,
  addDays,
  parseDuration,
  localDateTime,
  startOfWeek,
  formatDuration,
  isIsoDate,
} from '@/shared/date/time';
import { roundSeconds } from '@/domain/services/rounding';
import { occurrencesBetween, planOccurrences, occurrenceKey } from '@/domain/services/recurrence';
import {
  checkDefinitionOfDone,
  DEFAULT_WORKFLOW,
  validateWorkflow,
  wouldCreateCycle,
} from '@/domain/policies/workflow';
import { canTransitionTime, assertQuoteTransition } from '@/domain/policies/billing-status';
import { evaluateBudgets, profitability } from '@/domain/services/budget';
import { findDuplicateCustomers } from '@/domain/services/duplicates';
import { csvCell, toCsv, parseCsv } from '@/domain/services/csv';
import { UlidFactory, isUlid, ulidTime } from '@/shared/ids/ulid';
import { resolveHourlyRate } from '@/domain/services/rates';
import {
  CustomerSchema,
  ProjectSchema,
  TicketSchema,
  TimeEntrySchema,
} from '@/domain/schemas/entities';
import type { Customer, Project, RecurringTask, Ticket } from '@/domain/schemas/entities';

describe('money', () => {
  it('rounds half up away from zero', () => {
    expect(divRoundHalfUp(5, 2)).toBe(3);
    expect(divRoundHalfUp(-5, 2)).toBe(-3);
    expect(divRoundHalfUp(4, 3)).toBe(1);
  });
  it('amountForSeconds avoids floating point', () => {
    expect(amountForSeconds(5400, 7000)).toBe(10500);
    expect(amountForSeconds(1, 7000)).toBe(2); // 1.94 → 2
    expect(amountForSeconds(420, 7000)).toBe(817); // 816.67 → 817
    expect(0.1 + 0.2).not.toBe(0.3); // sanity: this is why we use cents
    expect(amountForSeconds(3600 * 1_000_000, 9_999_999)).toBe(9_999_999_000_000);
  });
  it('parses German and English inputs', () => {
    expect(parseMoney('70')).toBe(7000);
    expect(parseMoney('70,5')).toBe(7050);
    expect(parseMoney('1.234,56')).toBe(123456);
    expect(parseMoney('1,234.56')).toBe(123456);
    expect(parseMoney('85,00 €')).toBe(8500);
    expect(parseMoney('1.000')).toBe(100000);
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('1,234')).toBe(123400);
  });
  it('formats', () => {
    expect(formatMoney(123456)).toBe('1.234,56 €');
    expect(formatMoney(-5)).toBe('-0,05 €');
    expect(centsToDecimalString(-12345, ',')).toBe('-123,45');
    expect(lineTotal(1500, 8500)).toBe(12750);
  });
});

describe('time', () => {
  it('parses durations', () => {
    expect(parseDuration('1:30')).toBe(5400);
    expect(parseDuration('1,5')).toBe(5400);
    expect(parseDuration('1.25h')).toBe(4500);
    expect(parseDuration('90m')).toBe(5400);
    expect(parseDuration('45')).toBe(2700);
    expect(parseDuration('x')).toBeNull();
    expect(formatDuration(5400)).toBe('1:30');
    expect(formatDuration(3725, true)).toBe('1:02:05');
  });
  it('calendar math clamps months', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(startOfWeek('2026-10-25')).toBe('2026-10-19');
    expect(isIsoDate('2026-02-30')).toBe(false);
  });
  it('DST: local day math across the October transition', () => {
    // Regardless of TZ, adding days stays on calendar days.
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25');
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
    const a = localDateTime('2026-10-25', '01:00')!;
    const b = localDateTime('2026-10-25', '05:00')!;
    expect(b - a).toBeGreaterThanOrEqual(3 * 3600_000); // 4h nominal, 5h in Europe/Berlin
  });
  it('rounding rules', () => {
    expect(roundSeconds(420, { unit_minutes: 15, mode: 'up' })).toBe(900);
    expect(roundSeconds(420, { unit_minutes: 15, mode: 'down' })).toBe(0);
    expect(roundSeconds(450, { unit_minutes: 15, mode: 'nearest' })).toBe(900);
    expect(roundSeconds(449, { unit_minutes: 15, mode: 'nearest' })).toBe(0);
    expect(roundSeconds(-420, { unit_minutes: 15, mode: 'up' })).toBe(-900);
    expect(roundSeconds(421, { unit_minutes: 15, mode: 'none' })).toBe(421);
  });
});

describe('ids', () => {
  it('ULIDs are valid and monotonic within the same ms', () => {
    const f = new UlidFactory(() => 1700000000000);
    const a = f.next();
    const b = f.next();
    expect(isUlid(a)).toBe(true);
    expect(b > a).toBe(true);
    expect(ulidTime(a)).toBe(1700000000000);
  });
});

describe('recurrence', () => {
  const rec = (r: Partial<RecurringTask['recurrence']>) => ({
    freq: 'weekly' as const,
    interval: 1,
    weekdays: [],
    day_of_month: null,
    ...r,
  });
  it('weekly on given weekdays', () => {
    expect(
      occurrencesBetween(rec({ weekdays: [1, 4] }), '2026-10-01', '2026-10-01', '2026-10-15'),
    ).toEqual(['2026-10-01', '2026-10-05', '2026-10-08', '2026-10-12', '2026-10-15']);
  });
  it('bi-weekly', () => {
    expect(
      occurrencesBetween(rec({ interval: 2 }), '2026-10-05', '2026-10-01', '2026-11-05'),
    ).toEqual(['2026-10-05', '2026-10-19', '2026-11-02']);
  });
  it('monthly with clamping', () => {
    expect(
      occurrencesBetween(
        rec({ freq: 'monthly', day_of_month: 31 }),
        '2026-01-31',
        '2026-01-01',
        '2026-04-30',
      ),
    ).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });
  it('every n days and end date', () => {
    expect(
      occurrencesBetween(
        rec({ freq: 'interval_days', interval: 10 }),
        '2026-10-01',
        '2026-10-05',
        '2026-11-30',
        '2026-10-25',
      ),
    ).toEqual(['2026-10-11', '2026-10-21']);
  });
  it('plan is idempotent via occurrence keys and catches up missed occurrences', () => {
    const task = {
      id: 'REC-TEST000001',
      active: true,
      archived: false,
      start_date: '2026-09-01',
      end_date: null,
      generated_through: '2026-09-15',
      lead_days: 3,
      recurrence: rec({ freq: 'interval_days', interval: 7 }),
    } as unknown as RecurringTask;
    const plan = planOccurrences(task, '2026-10-01', new Set());
    expect(plan.map((p) => p.date)).toEqual(['2026-09-22', '2026-09-29']);
    const plan2 = planOccurrences(
      task,
      '2026-10-01',
      new Set([occurrenceKey(task.id, '2026-09-22')]),
    );
    expect(plan2.map((p) => p.date)).toEqual(['2026-09-29']);
  });
});

describe('workflow & definition of done', () => {
  const ticket = (over: Partial<Ticket>): Ticket =>
    ({ checklist: [], depends_on: [], estimated_seconds: null, ...over }) as Ticket;
  it('default rules do not block', () => {
    expect(
      checkDefinitionOfDone(
        ticket({ checklist: [{ id: '1', text: 'x', done: false, required: true }] }),
        {
          workflow: DEFAULT_WORKFLOW,
          rules: {
            requireChecklistComplete: 'none',
            requireDependenciesResolved: false,
            requireEstimate: false,
            requireTrackedTime: false,
          },
          dependencies: [],
          trackedSeconds: 0,
        },
      ),
    ).toEqual([]);
  });
  it('configured rules block', () => {
    const p = checkDefinitionOfDone(
      ticket({ checklist: [{ id: '1', text: 'x', done: false, required: true }] }),
      {
        workflow: DEFAULT_WORKFLOW,
        rules: {
          requireChecklistComplete: 'required_items',
          requireDependenciesResolved: true,
          requireEstimate: true,
          requireTrackedTime: true,
        },
        dependencies: [{ id: 'TKT-A00001', ticket_number: 'WEB-1', status: 'todo' }],
        trackedSeconds: 0,
      },
    );
    expect(p).toHaveLength(4);
  });
  it('validates workflow config and cycles', () => {
    expect(validateWorkflow(DEFAULT_WORKFLOW)).toEqual([]);
    expect(validateWorkflow([{ key: 'a', label: 'A', category: 'open' }])).toHaveLength(1);
    const deps = new Map([
      ['A', ['B']],
      ['B', ['C']],
    ]);
    expect(wouldCreateCycle(deps, 'C', 'A')).toBe(true);
    expect(wouldCreateCycle(deps, 'A', 'C')).toBe(false);
  });
  it('billing state machine', () => {
    expect(canTransitionTime('unbilled', 'approved')).toBe(true);
    expect(canTransitionTime('unbilled', 'invoiced')).toBe(false);
    expect(canTransitionTime('invoiced', 'unbilled')).toBe(false);
    expect(() => assertQuoteTransition('accepted', 'draft')).toThrow();
  });
});

describe('rates, budgets, profitability', () => {
  it('rate precedence', () => {
    expect(
      resolveHourlyRate({
        project: { rate_cents: null },
        customer: { default_rate_cents: null },
        service: { rate_cents: 8500 },
        defaultRateCents: 7000,
      }),
    ).toEqual({ rate_cents: 8500, source: 'service' });
    expect(
      resolveHourlyRate({
        project: { rate_cents: 9000 },
        customer: { default_rate_cents: 8000 },
        service: { rate_cents: 8500 },
        defaultRateCents: 7000,
      }).source,
    ).toBe('project');
  });
  it('budget thresholds', () => {
    const p = {
      billing_model: 'time_and_materials',
      budget_cents: 100000,
      budget_seconds: 36000,
      estimated_seconds: 18000,
    } as Project;
    const b = evaluateBudgets(
      p,
      {
        trackedSeconds: 18000,
        billableSeconds: 16200,
        nonBillableSeconds: 1800,
        billableValueCents: 76000,
        invoicedValueCents: 0,
        expensesCents: 0,
      },
      [50, 75, 90, 100],
    );
    expect(b.map((x) => x.reachedThreshold)).toEqual([75, null, 100]);
  });
  it('fixed-price profitability', () => {
    const p = {
      billing_model: 'fixed_price',
      fixed_price_cents: 300000,
      internal_cost_rate_cents: 4000,
    } as Project;
    const r = profitability(
      p,
      {
        trackedSeconds: 36000,
        billableSeconds: 36000,
        nonBillableSeconds: 0,
        billableValueCents: 0,
        invoicedValueCents: 0,
        expensesCents: 0,
      },
      null,
    );
    expect(r.revenueCents).toBe(300000);
    expect(r.internalCostCents).toBe(40000);
    expect(r.effectiveHourlyCents).toBe(30000);
  });
});

describe('duplicates & CSV', () => {
  const c = (o: Partial<Customer>) =>
    ({
      id: 'CUS-X00001',
      name: '',
      email: '',
      website: '',
      vat_id: '',
      phone: '',
      ...o,
    }) as Customer;
  it('detects similar customers', () => {
    const existing = [
      c({
        name: 'Müller Software GmbH',
        email: 'info@mueller-sw.de',
        website: 'https://www.mueller-sw.de',
      }),
    ];
    expect(
      findDuplicateCustomers(
        { name: 'Mueller Software', email: '', website: '', vat_id: '', phone: '' },
        existing,
      )[0]!.reasons,
    ).toContain('Gleicher Name');
    expect(
      findDuplicateCustomers(
        { name: 'Anders', email: 'kontakt@mueller-sw.de', website: '', vat_id: '', phone: '' },
        existing,
      )[0]!.reasons,
    ).toContain('Gleiche Domain');
    expect(
      findDuplicateCustomers(
        { name: 'Anders', email: 'a@gmail.com', website: '', vat_id: '', phone: '' },
        [c({ name: 'X', email: 'b@gmail.com' })],
      ),
    ).toEqual([]);
  });
  it('escapes CSV and guards formulas', () => {
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('-12,50')).toBe('-12,50');
    const text = toCsv(['a', 'b'], [['x\ny', 1]]);
    expect(parseCsv(text)).toEqual([
      ['a', 'b'],
      ['x\ny', '1'],
    ]);
  });
});

describe('schemas', () => {
  const base = {
    schema_version: 1,
    id: 'CUS-01JD3ABCDEF',
    created_at: '2026-10-23T08:00:00Z',
    updated_at: '2026-10-23T08:00:00Z',
  };
  it('validates customers and fills defaults', () => {
    const r = CustomerSchema.parse({
      ...base,
      type: 'customer',
      customer_number: 'K-0001',
      name: 'A',
    });
    expect(r.currency).toBe('EUR');
    expect(r.status).toBe('active');
    expect(CustomerSchema.safeParse({ ...base, type: 'customer', name: '' }).success).toBe(false);
  });
  it('rejects float money and bad keys', () => {
    expect(
      ProjectSchema.safeParse({
        ...base,
        id: 'PRJ-01JD3ABCDEF',
        type: 'project',
        key: 'web',
        name: 'x',
      }).success,
    ).toBe(false);
    expect(
      ProjectSchema.safeParse({
        ...base,
        id: 'PRJ-01JD3ABCDEF',
        type: 'project',
        key: 'WEB',
        name: 'x',
        rate_cents: 70.5,
      }).success,
    ).toBe(false);
  });
  it('time entry invariants', () => {
    const e = {
      ...base,
      id: 'TIM-01JD3ABCDEF',
      type: 'time_entry',
      project_id: 'PRJ-01JD3ABCDEF',
      started_at: '2026-10-23T09:00:00Z',
      ended_at: '2026-10-23T08:00:00Z',
      duration_seconds: 10,
      billable: true,
      rate_cents: 7000,
    };
    expect(TimeEntrySchema.safeParse(e).success).toBe(false);
    expect(TimeEntrySchema.safeParse({ ...e, ended_at: '2026-10-23T10:00:00Z' }).success).toBe(
      true,
    );
    expect(
      TimeEntrySchema.safeParse({ ...e, ended_at: '2026-10-23T10:00:00Z', duration_seconds: -5 })
        .success,
    ).toBe(false);
  });
  it('ticket requires title', () => {
    expect(
      TicketSchema.safeParse({
        ...base,
        id: 'TKT-01JD3ABCDEF',
        type: 'ticket',
        project_id: 'PRJ-01JD3ABCDEF',
        title: '',
      }).success,
    ).toBe(false);
  });
});
