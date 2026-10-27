import { describe, it, expect, afterEach } from 'vitest';
import { setLocale, t, msg, resolveLocale } from '@/shared/i18n';
import { de } from '@/shared/i18n/de';
import { en } from '@/shared/i18n/en';
import { makeEnv, seedBasic } from '../helpers/fixtures';
import { createManualEntry } from '@/application/use-cases/time';
import { CustomerSchema } from '@/domain/schemas/entities';
import { DEFAULT_SETTINGS, localizeFreshDefaults } from '@/core/configuration/settings';
import { describeRecurrence } from '@/domain/services/recurrence';

afterEach(() => setLocale('de'));

describe('i18n', () => {
  it('English dictionary covers every key with non-empty text', () => {
    for (const key of Object.keys(de))
      expect((en as Record<string, string>)[key]?.trim(), key).toBeTruthy();
  });
  it('resolves the language from the setting or Obsidian', () => {
    expect(resolveLocale('auto', 'de')).toBe('de');
    expect(resolveLocale('auto', 'de-at')).toBe('de');
    expect(resolveLocale('auto', 'en')).toBe('en');
    expect(resolveLocale('auto', 'fr')).toBe('en');
    expect(resolveLocale('de', 'en')).toBe('de');
  });
  it('switches UI strings and inline messages at runtime', () => {
    expect(t('nav.time')).toBe('Zeiterfassung');
    setLocale('en');
    expect(t('nav.time')).toBe('Time tracking');
    expect(msg('Ja', 'Yes')).toBe('Yes');
    expect(
      describeRecurrence({ freq: 'weekly', interval: 2, weekdays: [1, 5], day_of_month: null }),
    ).toBe('Every 2 weeks (Mon, Fri)');
  });
  it('validation and domain errors are translated', async () => {
    setLocale('en');
    const r = CustomerSchema.safeParse({
      schema_version: 1,
      id: 'CUS-01JD3ABCDEF',
      type: 'customer',
      created_at: '2026-10-23T08:00:00Z',
      updated_at: '2026-10-23T08:00:00Z',
      name: '',
    });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.message).toBe('Name is required');
    const env = await makeEnv();
    const { project } = await seedBasic(env);
    await expect(
      createManualEntry(env.core.ctx, {
        project_id: project.id,
        ticket_id: null,
        description: '',
        start: 10,
        end: 5,
        billable: true,
      }),
    ).rejects.toThrow('End must be after start');
  });
  it('fresh installs get categories and workflow labels in the UI language', () => {
    setLocale('en');
    const s = structuredClone(DEFAULT_SETTINGS);
    localizeFreshDefaults(s);
    expect(s.ticketCategories).toContain('Maintenance');
    expect(s.workflow.find((w) => w.key === 'in_progress')!.label).toBe('In progress');
  });
  it('new notes are written in the UI language', async () => {
    setLocale('en');
    const env = await makeEnv();
    const { ticket } = await seedBasic(env);
    const text = env.files.files.get(env.core.index.pathOf(ticket.id)!)!;
    expect(text).toContain('## Description');
    expect(text).toContain('Project: [[');
  });
});
