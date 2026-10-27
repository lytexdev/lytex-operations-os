<script lang="ts">
  import type { Snippet } from 'svelte';
  let { text, children }: { text: string; children?: Snippet } = $props();
</script>

<div class="lx-empty">
  <p>{text}</p>
  {#if children}{@render children()}{/if}
</div>
