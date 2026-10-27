<script lang="ts">
  import { t } from '@/shared/i18n';
  import type { DurationUnit } from '../forms/form-utils';
  let {
    text = $bindable(''),
    unit = $bindable<DurationUnit>('h'),
    label = '',
  }: { text?: string; unit?: DurationUnit; label?: string } = $props();
</script>

<span class="lx-duration-input">
  <input
    type="text"
    inputmode="decimal"
    bind:value={text}
    aria-label={label}
    placeholder={unit === 'h' ? '1,5' : '45'}
  />
  <select bind:value={unit} aria-label={t('common.unit')}>
    <option value="h">{t('common.hours')}</option>
    <option value="m">{t('common.minutes')}</option>
  </select>
</span>
