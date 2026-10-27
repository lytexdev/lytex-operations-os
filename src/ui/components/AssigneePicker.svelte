<script lang="ts">
  import { t } from '@/shared/i18n';
  /** Multiple choice of people; new names can be added as free text. */
  let {
    selected = $bindable<string[]>([]),
    team,
    onaddperson,
  }: { selected?: string[]; team: string[]; onaddperson?: (name: string) => void } = $props();
  let newName = $state('');
  const options = $derived([...new Set([...team, ...selected])]);

  function toggle(name: string) {
    selected = selected.includes(name) ? selected.filter((x) => x !== name) : [...selected, name];
  }
  function add() {
    const name = newName.trim().replace(/\s+/g, ' ');
    if (!name) return;
    if (!selected.includes(name)) selected = [...selected, name];
    if (!team.includes(name)) onaddperson?.(name);
    newName = '';
  }
</script>

<div class="lx-assignees">
  <div class="lx-radio-row">
    {#each options as name (name)}
      <label class="lx-check lx-chip" class:is-selected={selected.includes(name)}>
        <input type="checkbox" checked={selected.includes(name)} onchange={() => toggle(name)} />
        {name}
      </label>
    {/each}
  </div>
  <div class="lx-inline-form">
    <input
      type="text"
      bind:value={newName}
      placeholder={t('ticket.addPerson')}
      aria-label={t('ticket.addPerson')}
      onkeydown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          add();
        }
      }}
    />
    <button type="button" onclick={add} disabled={!newName.trim()}>+</button>
  </div>
</div>
