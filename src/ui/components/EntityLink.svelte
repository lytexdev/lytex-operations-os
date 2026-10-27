<script lang="ts">
  import type { UiApi } from '../stores/ui-api';
  import type { RouteName } from '../navigation/router';
  let {
    api,
    id,
    route,
    text,
  }: { api: UiApi; id: string | null | undefined; route: RouteName; text: string } = $props();
</script>

{#if id}
  <button type="button" class="lx-link" onclick={() => api.router.go({ name: route, id })}
    >{text}</button
  >
{:else}
  <span class="lx-muted">{text}</span>
{/if}
