<script lang="ts">
  import type { Snippet } from 'svelte';
  let {
    label,
    error = '',
    hint = '',
    required = false,
    children,
    wide = false,
  }: {
    label: string;
    error?: string;
    hint?: string;
    required?: boolean;
    children: Snippet;
    wide?: boolean;
  } = $props();
</script>

<label class="lx-field" class:lx-field-wide={wide} class:lx-has-error={!!error}>
  <span class="lx-field-label"
    >{label}{#if required}<span class="lx-req" aria-hidden="true">*</span>{/if}</span
  >
  {@render children()}
  {#if error}<span class="lx-field-error" role="alert">{error}</span>{:else if hint}<span
      class="lx-field-hint">{hint}</span
    >{/if}
</label>
