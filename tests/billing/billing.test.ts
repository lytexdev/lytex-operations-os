import { describe, it, expect } from 'vitest';
import { makeEnv, seedBasic, H } from '../helpers/fixtures';
import {
  createManualEntry,
  setBillingStatus,
  editEntry,
  createAdjustment,
} from '@/application/use-cases/time';
import {
  createBatch,
  previewBatch,
  exportBatchCsv,
  confirmInvoice,
  cancelBatch,
  recordPayment,
} from '@/application/use-cases/billing';
import { financeSummary } from '@/application/queries/aggregates';
import { parseCsv } from '@/domain/services/csv';
import { createExpense, setExpenseStatus, quoteTotals } from '@/application/use-cases/finance';
import { updateCustomer } from '@/application/use-cases/crm';

const T0 = Date.parse('2026-10-20T08:00:00Z');

async function withEntries(projectPatch = {}) {
  const env = await makeEnv();
  const seed = await seedBasic(env, projectPatch);
  const ctx = env.core.ctx;
  const e1 = await createManualEntry(ctx, {
    project_id: seed.project.id,
    ticket_id: seed.ticket.id,
    description: 'A',
    start: T0,
    end: T0 + 1.5 * H,
    billable: true,
  });
  const e2 = await createManualEntry(ctx, {
    project_id: seed.project.id,
    ticket_id: null,
    description: 'B',
    start: T0 + 2 * H,
    end: T0 + 2 * H + 7 * 60_000,
    billable: true,
  });
  const e3 = await createManualEntry(ctx, {
    project_id: seed.project.id,
    ticket_id: null,
    description: 'intern',
    start: T0 + 3 * H,
    end: T0 + 4 * H,
    billable: false,
  });
  return { env, seed, ctx, e1, e2, e3 };
}

describe('rates', () => {
  it('applies precedence project > customer > service > default and snapshots it', async () => {
    const env = await makeEnv();
    const seed = await seedBasic(env);
    const ctx = env.core.ctx;
    const a = await createManualEntry(ctx, {
      project_id: seed.project.id,
      ticket_id: null,
      description: '',
      start: T0,
      end: T0 + H,
      billable: true,
    });
    expect([a.rate_cents, a.rate_source]).toEqual([7000, 'default']);
    await updateCustomer(ctx, seed.customer.id, { default_rate_cents: 8000 });
    const b = await createManualEntry(ctx, {
      project_id: seed.project.id,
      ticket_id: null,
      description: '',
      start: T0 + H,
      end: T0 + 2 * H,
      billable: true,
    });
    expect([b.rate_cents, b.rate_source]).toEqual([8000, 'customer']);
    await env.core.repo.update('project', seed.project.id, (d) => {
      d.rate_cents = 9500;
    });
    const c = await createManualEntry(ctx, {
      project_id: seed.project.id,
      ticket_id: null,
      description: '',
      start: T0 + 2 * H,
      end: T0 + 3 * H,
      billable: true,
    });
    expect([c.rate_cents, c.rate_source]).toEqual([9500, 'project']);
    // Historical entries are unchanged.
    expect(env.core.repo.get('time_entry', a.id).rate_cents).toBe(7000);
  });

  it('internal projects are never billable', async () => {
    const env = await makeEnv();
    const seed = await seedBasic(env, { billing_model: 'internal', customer_id: null });
    const e = await createManualEntry(env.core.ctx, {
      project_id: seed.project.id,
      ticket_id: null,
      description: '',
      start: T0,
      end: T0 + H,
      billable: true,
    });
    expect(e.billable).toBe(false);
  });
});

describe('manual entries', () => {
  it('validates and detects overlaps', async () => {
    const { ctx, seed } = await withEntries();
    await expect(
      createManualEntry(ctx, {
        project_id: seed.project.id,
        ticket_id: null,
        description: '',
        start: T0 + H,
        end: T0 + 2 * H,
        billable: true,
      }),
    ).rejects.toThrow(/Überschneidung/);
    const ok = await createManualEntry(ctx, {
      project_id: seed.project.id,
      ticket_id: null,
      description: '',
      start: T0 + H,
      end: T0 + 2 * H,
      billable: true,
      overlap_acknowledged: true,
    });
    expect(ok.overlap_acknowledged).toBe(true);
    await expect(
      createManualEntry(ctx, {
        project_id: seed.project.id,
        ticket_id: null,
        description: '',
        start: T0,
        end: T0 - 1,
        billable: true,
      }),
    ).rejects.toThrow(/Ende/);
  });

  it('block policy forbids overlaps even with acknowledgement', async () => {
    const { ctx, seed, env } = await withEntries();
    env.settings.overlapPolicy = 'block';
    await expect(
      createManualEntry(ctx, {
        project_id: seed.project.id,
        ticket_id: null,
        description: '',
        start: T0,
        end: T0 + H,
        billable: true,
        overlap_acknowledged: true,
      }),
    ).rejects.toThrow(/Überschneidung/);
  });

  it('edits unbilled entries with history; locks billed entries', async () => {
    const { ctx, e1, seed } = await withEntries();
    const edited = await editEntry(ctx, e1.id, {
      description: 'A2',
      end: T0 + H,
      reason: 'Tippfehler',
    });
    expect(edited.duration_seconds).toBe(3600);
    expect(edited.history.at(-1)!.detail).toMatch(/duration_seconds: 5400 → 3600/);
    await setBillingStatus(ctx, [e1.id], 'approved');
    await createBatch(ctx, {
      customer_id: seed.customer.id,
      entry_ids: [e1.id],
      expense_ids: [],
      include_fixed_price: [],
      retainer_months: {},
      discount_bp: 0,
      period_from: null,
      period_to: null,
    });
    await expect(editEntry(ctx, e1.id, { description: 'x' })).rejects.toThrow(/Korrekturbuchung/);
  });
});

describe('billing batches', () => {
  it('computes amounts with integer cents and per-entry rounding', async () => {
    const { ctx, env, e1, e2, seed } = await withEntries();
    env.settings.rounding = { unit_minutes: 15, mode: 'up' };
    await setBillingStatus(ctx, [e1.id, e2.id], 'approved');
    const prev = previewBatch(ctx, {
      customer_id: seed.customer.id,
      entry_ids: [e1.id, e2.id],
      expense_ids: [],
      include_fixed_price: [],
      retainer_months: {},
      discount_bp: 0,
      period_from: null,
      period_to: null,
    });
    // 1.5 h × 70 € = 105 €; 7 min → 15 min × 70 € = 17,50 €
    expect(prev.lines.map((l) => l.total_cents)).toEqual([10500, 1750]);
    expect(prev.netCents).toBe(12250);
    expect(prev.lines[1]!.quantity_milli).toBe(250);
  });

  it('rejects unapproved, non-billable and already reserved entries (no double billing)', async () => {
    const { ctx, e1, e3, seed } = await withEntries();
    const req = {
      customer_id: seed.customer.id,
      entry_ids: [e1.id],
      expense_ids: [],
      include_fixed_price: [],
      retainer_months: {},
      discount_bp: 0,
      period_from: null,
      period_to: null,
    };
    await expect(createBatch(ctx, req)).rejects.toThrow(/nicht freigegeben|bereits/);
    await expect(setBillingStatus(ctx, [e3.id], 'approved')).resolves.toMatchObject({
      failed: [{ id: e3.id }],
    });
    await setBillingStatus(ctx, [e1.id], 'approved');
    await createBatch(ctx, req);
    await expect(createBatch(ctx, req)).rejects.toThrow(/bereits/);
    await expect(Promise.all([createBatch(ctx, req), createBatch(ctx, req)])).rejects.toThrow();
    expect(ctx.index.all('billing_batch')).toHaveLength(1);
  });

  it('full flow: batch → CSV export (no status change) → confirm invoice → payment', async () => {
    const { ctx, env, e1, e2, seed } = await withEntries();
    await setBillingStatus(ctx, [e1.id, e2.id], 'approved');
    const batch = await createBatch(ctx, {
      customer_id: seed.customer.id,
      entry_ids: [e1.id, e2.id],
      expense_ids: [],
      include_fixed_price: [],
      retainer_months: {},
      discount_bp: 0,
      period_from: '2026-10-01',
      period_to: '2026-10-31',
    });
    expect(batch.batch_number).toBe('AB-2026-001');
    expect(ctx.repo.get('time_entry', e1.id).billing_status).toBe('reserved');
    expect(ctx.repo.get('time_entry', e1.id).billing_batch_id).toBe(batch.id);

    const path = await exportBatchCsv(ctx, batch.id);
    const csv = env.files.files.get(path)!;
    const rows = parseCsv(csv, ';');
    expect(rows[0]![0]).toBe('Abrechnungslauf');
    expect(rows).toHaveLength(4); // header + 2 lines + sum
    expect(rows[3]![10]).toBe('113,17'); // 105,00 + 8,17 (7 min × 70 €)
    expect(ctx.repo.get('time_entry', e1.id).billing_status).toBe('reserved'); // NOT invoiced by export
    expect(ctx.repo.get('billing_batch', batch.id).status).toBe('exported');

    await confirmInvoice(ctx, batch.id, 'RE-2026-0042', '2026-10-31');
    expect(ctx.repo.get('time_entry', e1.id).billing_status).toBe('invoiced');
    expect(financeSummary(ctx.index).invoicedCents).toBe(11317);
    expect(financeSummary(ctx.index).paidCents).toBe(0);
    await recordPayment(ctx, batch.id, '2026-11-10', 11317);
    expect(financeSummary(ctx.index).paidCents).toBe(11317);
  });

  it('cancelling a batch releases entries back to approved', async () => {
    const { ctx, e1, seed } = await withEntries();
    await setBillingStatus(ctx, [e1.id], 'approved');
    const b = await createBatch(ctx, {
      customer_id: seed.customer.id,
      entry_ids: [e1.id],
      expense_ids: [],
      include_fixed_price: [],
      retainer_months: {},
      discount_bp: 0,
      period_from: null,
      period_to: null,
    });
    await cancelBatch(ctx, b.id, 'Test');
    const e = ctx.repo.get('time_entry', e1.id);
    expect(e.billing_status).toBe('approved');
    expect(e.billing_batch_id).toBeNull();
    await confirmInvoice(ctx, b.id, 'X', '2026-10-31').catch((err: Error) =>
      expect(err.message).toMatch(/nicht erlaubt/),
    );
  });

  it('interrupted batch creation is completed on restart via the journal', async () => {
    const { ctx, env, e1, e2, seed } = await withEntries();
    await setBillingStatus(ctx, [e1.id, e2.id], 'approved');
    const e2Path = ctx.index.pathOf(e2.id)!;
    env.files.failNextWrite = { match: (p) => p === e2Path, truncateTo: 5 };
    await expect(
      createBatch(ctx, {
        customer_id: seed.customer.id,
        entry_ids: [e1.id, e2.id],
        expense_ids: [],
        include_fixed_price: [],
        retainer_months: {},
        discount_bp: 0,
        period_from: null,
        period_to: null,
      }),
    ).rejects.toThrow();
    const { restart } = await import('../helpers/fixtures');
    const env2 = await restart(env);
    const b = env2.core.index.all('billing_batch')[0]!;
    expect(env2.core.repo.get('time_entry', e2.id).billing_batch_id).toBe(b.id);
    expect(env2.core.repo.get('time_entry', e2.id).billing_status).toBe('reserved');
    expect(env2.core.index.issues().filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  it('fixed price: time is documented at zero value, price only when explicitly included', async () => {
    const { ctx, e1, seed } = await withEntries({
      billing_model: 'fixed_price',
      fixed_price_cents: 250000,
    });
    await setBillingStatus(ctx, [e1.id], 'approved');
    const p = previewBatch(ctx, {
      customer_id: seed.customer.id,
      entry_ids: [e1.id],
      expense_ids: [],
      include_fixed_price: [],
      retainer_months: {},
      discount_bp: 0,
      period_from: null,
      period_to: null,
    });
    expect(p.netCents).toBe(0);
    const p2 = previewBatch(ctx, {
      customer_id: seed.customer.id,
      entry_ids: [e1.id],
      expense_ids: [],
      include_fixed_price: [seed.project.id],
      retainer_months: {},
      discount_bp: 0,
      period_from: null,
      period_to: null,
    });
    expect(p2.netCents).toBe(250000);
  });

  it('retainer: fee + overage beyond included hours', async () => {
    const { ctx, e1, e2, seed } = await withEntries({
      billing_model: 'retainer',
      retainer_monthly_fee_cents: 50000,
      retainer_included_seconds: 3600,
    });
    await setBillingStatus(ctx, [e1.id, e2.id], 'approved');
    const p = previewBatch(ctx, {
      customer_id: seed.customer.id,
      entry_ids: [e1.id, e2.id],
      expense_ids: [],
      include_fixed_price: [],
      retainer_months: { [seed.project.id]: 1 },
      discount_bp: 0,
      period_from: null,
      period_to: null,
    });
    // included 1 h; overage 0.5 h (35 €) + 7 min (8,17 €); fee 500 €
    expect(p.netCents).toBe(50000 + 3500 + 817);
  });

  it('daily rate only applies when contractually billed per day', async () => {
    const { ctx, e1, seed } = await withEntries({ billing_unit: 'day', daily_rate_cents: 55000 });
    await setBillingStatus(ctx, [e1.id], 'approved');
    const p = previewBatch(ctx, {
      customer_id: seed.customer.id,
      entry_ids: [e1.id],
      expense_ids: [],
      include_fixed_price: [],
      retainer_months: {},
      discount_bp: 0,
      period_from: null,
      period_to: null,
    });
    // 1.5 h / 8 h = 0.1875 day → qty 188 (thousandths) × 550 € = 103,40 €
    expect(p.lines[0]!.unit).toBe('Tag');
    expect(p.lines[0]!.quantity_milli).toBe(188);
    expect(p.lines[0]!.total_cents).toBe(10340);
  });

  it('discounts and expenses', async () => {
    const { ctx, e1, seed } = await withEntries();
    const x = await createExpense(ctx, {
      customer_id: null,
      project_id: seed.project.id,
      date: '2026-10-20',
      vendor: 'Hoster',
      description: 'Domain',
      category: 'Hosting',
      amount_cents: 1999,
      currency: 'EUR',
      reimbursable: true,
      billing_status: 'unbilled',
      billing_batch_id: null,
      receipt: '',
    });
    expect(x.customer_id).toBe(seed.customer.id);
    await setExpenseStatus(ctx, x.id, 'approved');
    await setBillingStatus(ctx, [e1.id], 'approved');
    const p = previewBatch(ctx, {
      customer_id: seed.customer.id,
      entry_ids: [e1.id],
      expense_ids: [x.id],
      include_fixed_price: [],
      retainer_months: {},
      discount_bp: 1000,
      period_from: null,
      period_to: null,
    });
    // (10500 + 1999) × 10 % = 1249,9 → 1250
    expect(p.netCents).toBe(10500 + 1999 - 1250);
  });

  it('adjustments for invoiced entries', async () => {
    const { ctx, e1, seed } = await withEntries();
    await setBillingStatus(ctx, [e1.id], 'approved');
    const b = await createBatch(ctx, {
      customer_id: seed.customer.id,
      entry_ids: [e1.id],
      expense_ids: [],
      include_fixed_price: [],
      retainer_months: {},
      discount_bp: 0,
      period_from: null,
      period_to: null,
    });
    await confirmInvoice(ctx, b.id, 'RE-1', '2026-10-31');
    const adj = await createAdjustment(ctx, e1.id, -1800, 'Zu viel erfasst');
    expect(adj.duration_seconds).toBe(-1800);
    expect(ctx.repo.get('time_entry', e1.id).billing_status).toBe('adjusted');
    expect(ctx.repo.get('time_entry', e1.id).duration_seconds).toBe(5400); // original unchanged
    await setBillingStatus(ctx, [adj.id], 'approved');
    const p = previewBatch(ctx, {
      customer_id: seed.customer.id,
      entry_ids: [adj.id],
      expense_ids: [],
      include_fixed_price: [],
      retainer_months: {},
      discount_bp: 0,
      period_from: null,
      period_to: null,
    });
    expect(p.netCents).toBe(-3500);
  });

  it('duplicate invoice reference is rejected', async () => {
    const { ctx, e1, e2, seed } = await withEntries();
    await setBillingStatus(ctx, [e1.id, e2.id], 'approved');
    const b1 = await createBatch(ctx, {
      customer_id: seed.customer.id,
      entry_ids: [e1.id],
      expense_ids: [],
      include_fixed_price: [],
      retainer_months: {},
      discount_bp: 0,
      period_from: null,
      period_to: null,
    });
    const b2 = await createBatch(ctx, {
      customer_id: seed.customer.id,
      entry_ids: [e2.id],
      expense_ids: [],
      include_fixed_price: [],
      retainer_months: {},
      discount_bp: 0,
      period_from: null,
      period_to: null,
    });
    await confirmInvoice(ctx, b1.id, 'RE-7', '2026-10-31');
    await expect(confirmInvoice(ctx, b2.id, 'RE-7', '2026-10-31')).rejects.toThrow(/bereits/);
  });
});

describe('quotes', () => {
  it('totals with discount in integer cents', () => {
    const t = quoteTotals({
      lines: [
        { description: 'a', quantity_milli: 1500, unit: 'Std.', unit_price_cents: 8500 },
        { description: 'b', quantity_milli: 3000, unit: 'Stk.', unit_price_cents: 333 },
      ],
      discount_bp: 500,
    });
    expect(t.subtotalCents).toBe(12750 + 999);
    expect(t.discountCents).toBe(687); // 686,95 → 687
    expect(t.netCents).toBe(13749 - 687);
  });
});
