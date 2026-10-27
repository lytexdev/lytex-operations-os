<script lang="ts">
  /** Simple accessible SVG bar chart (vertical columns). Values are numbers; format renders labels. */
  interface Item {
    label: string;
    value: number;
    value2?: number;
  }
  let {
    items,
    format,
    legend = [],
    height = 140,
  }: {
    items: Item[];
    format: (v: number) => string;
    legend?: string[];
    height?: number;
  } = $props();
  const max = $derived(Math.max(1, ...items.map((i) => Math.max(i.value, i.value2 ?? 0))));
  const w = $derived(Math.max(items.length, 1));
</script>

{#if items.length === 0}
  <p class="lx-muted">—</p>
{:else}
  <figure class="lx-chart">
    <svg
      viewBox="0 0 {w * 20} {height}"
      preserveAspectRatio="none"
      role="img"
      aria-label={legend.join(', ')}
    >
      {#each items as it, i (i)}
        <rect
          class="lx-bar"
          x={i * 20 + 3}
          y={height - (it.value / max) * (height - 4)}
          width="14"
          height={(it.value / max) * (height - 4)}
        >
          <title
            >{it.label}: {format(it.value)}{it.value2 !== undefined
              ? ` / ${format(it.value2)}`
              : ''}</title
          >
        </rect>
        {#if it.value2 !== undefined}
          <rect
            class="lx-bar lx-bar-2"
            x={i * 20 + 6}
            y={height - (it.value2 / max) * (height - 4)}
            width="8"
            height={(it.value2 / max) * (height - 4)}
          >
            <title>{it.label}: {format(it.value2)}</title>
          </rect>
        {/if}
      {/each}
    </svg>
    <figcaption class="lx-chart-axis">
      <span>{items[0]?.label}</span>
      {#if legend.length}<span class="lx-chart-legend"
          >{#each legend as l, i (i)}<span class="lx-legend-{i}">■ {l}</span>{/each}</span
        >{/if}
      <span>{items[items.length - 1]?.label}</span>
    </figcaption>
  </figure>
{/if}
