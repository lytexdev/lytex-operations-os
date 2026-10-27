<script lang="ts">
  let {
    ratio,
    label = '',
    detail = '',
  }: { ratio: number; label?: string; detail?: string } = $props();
  const pctValue = $derived(Math.max(0, Math.min(100, Math.round(ratio * 100))));
  const tone = $derived(
    ratio >= 1 ? 'danger' : ratio >= 0.9 ? 'warn' : ratio >= 0.75 ? 'caution' : 'ok',
  );
</script>

<div class="lx-progress-wrap">
  {#if label}
    <div class="lx-progress-head">
      <span>{label}</span><span class="lx-muted">{detail} · {Math.round(ratio * 100)} %</span>
    </div>
  {/if}
  <div
    class="lx-progress"
    role="progressbar"
    aria-valuenow={pctValue}
    aria-valuemin="0"
    aria-valuemax="100"
    aria-label={label}
  >
    <div class="lx-progress-bar lx-tone-{tone}" style:width="{pctValue}%"></div>
  </div>
</div>
