<script lang="ts">
  /** Horizontal ranked bars, e.g. hours per customer. */
  interface Item {
    id?: string;
    label: string;
    value: number;
  }
  let {
    items,
    format,
    onselect,
    limit = 10,
  }: {
    items: Item[];
    format: (v: number) => string;
    onselect?: (id: string) => void;
    limit?: number;
  } = $props();
  const shown = $derived([...items].sort((a, b) => b.value - a.value).slice(0, limit));
  const max = $derived(Math.max(1, ...shown.map((i) => i.value)));
</script>

{#if shown.length === 0}
  <p class="lx-muted">—</p>
{:else}
  <ul class="lx-hbars">
    {#each shown as it, i (it.id ?? i)}
      <li>
        {#if onselect && it.id}
          <button type="button" class="lx-link" onclick={() => onselect?.(it.id!)}
            >{it.label}</button
          >
        {:else}
          <span>{it.label}</span>
        {/if}
        <span class="lx-hbar"
          ><span class="lx-hbar-fill" style:width="{(it.value / max) * 100}%"></span></span
        >
        <span class="lx-num">{format(it.value)}</span>
      </li>
    {/each}
  </ul>
{/if}
