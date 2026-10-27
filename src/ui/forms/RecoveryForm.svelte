<script lang="ts">
  import { msg } from '@/shared/i18n';
  import type { UiApi } from '../stores/ui-api';
  import { t } from '@/shared/i18n';
  import { formatDuration, localDate, formatLocalTime } from '@/shared/date/time';
  import { dateTimeField } from './form-utils';
  import { dateTime } from '../components/labels';
  import { toIso } from '@/shared/date/time';

  let { api, close }: { api: UiApi; close: () => void } = $props();
  const s = api.core.timer.session;
  const gap = s?.gap;
  const project = s ? api.ctx.index.get('project', s.project_id) : undefined;
  const ticket = s ? api.ctx.index.get('ticket', s.ticket_id) : undefined;
  let endDate = $state(gap ? localDate(gap.from) : '');
  let endTime = $state(gap ? formatLocalTime(gap.from) : '');
  let error = $state('');

  async function resolve(
    kind: 'exclude_stop' | 'exclude_resume' | 'include' | 'end_at' | 'discard',
  ) {
    error = '';
    if (
      kind === 'discard' &&
      !(await api.confirm(t('timer.recovery.discard'), t('timer.discardConfirm')))
    )
      return;
    if (kind === 'end_at') {
      const at = dateTimeField(endDate, endTime);
      if (at.error !== undefined) {
        error = at.error;
        return;
      }
      if (gap && (at.value < gap.from || at.value > Date.now())) {
        error = msg(
          `Zwischen ${dateTime(toIso(gap.from))} und jetzt wählen`,
          `Choose a time between ${dateTime(toIso(gap.from))} and now`,
        );
        return;
      }
      const r = await api.run(() => api.core.timer.recover({ kind: 'end_at', at: at.value }));
      if (r !== undefined) close();
      return;
    }
    const res =
      kind === 'exclude_stop'
        ? { kind: 'exclude_gap' as const, then: 'stop' as const }
        : kind === 'exclude_resume'
          ? { kind: 'exclude_gap' as const, then: 'resume' as const }
          : kind === 'include'
            ? { kind: 'include_gap' as const, then: 'resume' as const }
            : { kind: 'discard' as const };
    const r = await api.run(() => api.core.timer.recover(res));
    if (r !== undefined) {
      if (r?.kind === 'committed')
        api.notify(t('timer.saved', { d: formatDuration(r.durationSeconds) }), 'success');
      close();
    }
  }
</script>

{#if !s || !gap}
  <p>{t('timer.idle')}</p>
{:else}
  <div class="lx-form">
    <p>
      <strong>{project?.name ?? '—'}</strong>{ticket
        ? ` · ${ticket.ticket_number} ${ticket.title}`
        : ''}
    </p>
    <p>
      {t('timer.recovery.text', {
        last: dateTime(toIso(gap.from)),
        elapsed: formatDuration(api.core.timer.elapsedSeconds(), true),
      })}
    </p>
    <p class="lx-muted lx-small">
      {msg('Unterbrechung', 'Interruption')}: {dateTime(toIso(gap.from))} – {dateTime(
        toIso(gap.to),
      )} ({formatDuration(Math.round((gap.to - gap.from) / 1000))})
    </p>
    <div class="lx-recovery-actions">
      <button type="button" class="mod-cta" onclick={() => resolve('exclude_stop')}
        >{t('timer.recovery.exclude')}</button
      >
      <button type="button" onclick={() => resolve('exclude_resume')}
        >{t('timer.recovery.resume')}</button
      >
      <div class="lx-inline-form">
        <input type="date" bind:value={endDate} aria-label={t('time.date')} />
        <input type="time" bind:value={endTime} aria-label={t('time.end')} />
        <button type="button" onclick={() => resolve('end_at')}>{t('timer.recovery.endAt')}</button>
      </div>
      <button type="button" onclick={() => resolve('include')}>{t('timer.recovery.include')}</button
      >
      <button type="button" class="mod-warning" onclick={() => resolve('discard')}
        >{t('timer.recovery.discard')}</button
      >
    </div>
    {#if error}<p class="lx-field-error" role="alert">{error}</p>{/if}
  </div>
{/if}
