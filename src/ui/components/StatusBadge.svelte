<script lang="ts">
  import { label } from './labels';
  let { prefix, value }: { prefix: string; value: string } = $props();
  const TONES: Record<string, string> = {
    active: 'ok',
    approved: 'ok',
    invoiced: 'brand',
    accepted: 'ok',
    done: 'ok',
    completed: 'ok',
    exported: 'info',
    reserved: 'info',
    sent: 'info',
    review: 'info',
    in_progress: 'info',
    lead: 'warn',
    unbilled: 'warn',
    draft: 'muted',
    planned: 'muted',
    on_hold: 'warn',
    blocked: 'danger',
    cancelled: 'muted',
    archived: 'muted',
    inactive: 'muted',
    rejected: 'danger',
    expired: 'muted',
    written_off: 'muted',
    adjusted: 'warn',
    critical: 'danger',
    high: 'warn',
    low: 'muted',
    normal: 'default',
  };
</script>

<span
  class="lx-badge lx-badge-{prefix === 'priority' && (value === 'low' || value === 'normal')
    ? `prio-${value}`
    : (TONES[value] ?? 'default')}">{label(prefix, value)}</span
>
