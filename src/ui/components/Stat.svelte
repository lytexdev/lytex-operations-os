<script lang="ts">
  let {
    label,
    value,
    hint = '',
    tone = 'default',
    onclick,
  }: {
    label: string;
    value: string;
    hint?: string;
    tone?: 'default' | 'warn' | 'danger' | 'ok' | 'brand';
    onclick?: () => void;
  } = $props();
</script>

{#if onclick}
  <button class="lx-stat lx-tone-{tone} lx-clickable" {onclick} type="button">
    <span class="lx-stat-label">{label}</span>
    <span class="lx-stat-value">{value}</span>
    {#if hint}<span class="lx-stat-hint">{hint}</span>{/if}
  </button>
{:else}
  <div class="lx-stat lx-tone-{tone}">
    <span class="lx-stat-label">{label}</span>
    <span class="lx-stat-value">{value}</span>
    {#if hint}<span class="lx-stat-hint">{hint}</span>{/if}
  </div>
{/if}
