<script lang="ts">
  let { text, tone = 'default' }: { text: string; tone?: string } = $props();
</script>

<span class="lx-badge lx-badge-{tone}">{text}</span>
