<script lang="ts">
  import type { Snippet } from 'svelte';
  let { title, actions, children }: { title: string; actions?: Snippet; children: Snippet } =
    $props();
</script>

<section class="lx-section">
  <header class="lx-section-head">
    <h3>{title}</h3>
    {#if actions}<div class="lx-actions">{@render actions()}</div>{/if}
  </header>
  {@render children()}
</section>
