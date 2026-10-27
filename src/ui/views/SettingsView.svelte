<script lang="ts">
  import { msg } from '@/shared/i18n';
  import type { UiApi, SecretId } from '../stores/ui-api';
  import { t } from '@/shared/i18n';
  import { DEFAULT_ACCENT } from '@/core/configuration/settings';
  import Section from '../components/Section.svelte';

  let { api }: { api: UiApi } = $props();
  const s = api.settings();

  // ---- Darstellung
  const PRESETS: [string, string][] = [
    [msg('LYTEX Grün', 'LYTEX green'), DEFAULT_ACCENT],
    [msg('Petrol', 'Teal'), '#0f766e'],
    [msg('Blau', 'Blue'), '#1d4ed8'],
    ['Indigo', '#4338ca'],
    [msg('Violett', 'Violet'), '#6d28d9'],
    ['Bordeaux', '#9f1239'],
    ['Orange', '#c2410c'],
    [msg('Anthrazit', 'Graphite'), '#374151'],
  ];
  let accent = $state(s.accentColor);
  async function setAccent(color: string) {
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return;
    accent = color;
    s.accentColor = color;
    await api.saveSettings();
  }

  // ---- Team
  let team = $state([...s.team]);
  let me = $state(s.me);
  let defaultAssignee = $state(s.defaultAssignee);
  let newPerson = $state('');
  async function saveTeam() {
    s.team = [...team];
    if (!team.includes(me)) me = team[0] ?? '';
    if (defaultAssignee && !team.includes(defaultAssignee)) defaultAssignee = me;
    s.me = me;
    s.defaultAssignee = defaultAssignee;
    await api.saveSettings();
  }
  function addPerson() {
    const name = newPerson.trim().replace(/\s+/g, ' ');
    if (!name || team.includes(name)) return;
    team = [...team, name];
    newPerson = '';
    // The first person added becomes "me" and the default assignee.
    if (!me) me = name;
    if (!defaultAssignee) defaultAssignee = name;
    void saveTeam();
  }
  async function removePerson(name: string) {
    if (name === me) {
      api.notify(t('settings.cannotRemoveMe'), 'error');
      return;
    }
    if (!(await api.confirm(t('settings.team'), t('settings.removePerson', { name })))) return;
    team = team.filter((x) => x !== name);
    await saveTeam();
  }

  // ---- Integrationen (Keychain)
  const SECRETS: { id: SecretId; label: string; group: string }[] = [
    { id: 'lytex-lexware-api-key', label: t('settings.lexwareKey'), group: 'Lexware Office' },
    { id: 'lytex-openai-api-key', label: t('settings.openai'), group: 'AI' },
    { id: 'lytex-deepl-api-key', label: t('settings.deepl'), group: 'AI' },
  ];
  let drafts = $state<Record<string, string>>({});
  let revision = $state(0);
  function saveSecret(id: SecretId) {
    const v = (drafts[id] ?? '').trim();
    if (!v) return;
    api.secrets.set(id, v);
    drafts[id] = '';
    revision++;
    api.notify(t('common.saved'), 'success');
  }
  async function clearSecret(id: SecretId, label: string) {
    if (
      !(await api.confirm(
        t('settings.secretRemove'),
        t('delete.question', { label }),
        t('settings.secretRemove'),
      ))
    )
      return;
    api.secrets.clear(id);
    revision++;
  }
</script>

<div class="lx-page lx-settings-page">
  <div class="lx-toolbar"><h2>{t('nav.settings')}</h2></div>

  <Section title={t('settings.appearance')}>
    <p class="lx-muted lx-small">{t('settings.accentDesc')}</p>
    <div class="lx-swatches" role="radiogroup" aria-label={t('settings.accent')}>
      {#each PRESETS as [name, color] (color)}
        <button
          type="button"
          role="radio"
          aria-checked={accent.toLowerCase() === color}
          class="lx-swatch"
          class:is-active={accent.toLowerCase() === color}
          style:--swatch={color}
          title={name}
          onclick={() => setAccent(color)}><span></span>{name}</button
        >
      {/each}
    </div>
    <div class="lx-inline-form">
      <label class="lx-check"
        >{t('settings.accent')}:
        <input
          type="color"
          value={accent}
          onchange={(e) => setAccent((e.currentTarget as HTMLInputElement).value)}
        /></label
      >
      <code>{accent}</code>
      <button type="button" onclick={() => setAccent(DEFAULT_ACCENT)}>{t('settings.reset')}</button>
    </div>
  </Section>

  <Section title={t('settings.team')}>
    <p class="lx-muted lx-small">{t('settings.teamDesc')}</p>
    <ul class="lx-list">
      {#each team as name (name)}
        <li>
          <span>{name}{name === me ? ` · ${t('settings.itsMe')}` : ''}</span>
          <button
            type="button"
            class="lx-icon-btn"
            aria-label={t('common.delete')}
            onclick={() => removePerson(name)}>✕</button
          >
        </li>
      {/each}
    </ul>
    <form
      class="lx-inline-form"
      onsubmit={(e) => {
        e.preventDefault();
        addPerson();
      }}
    >
      <input
        type="text"
        bind:value={newPerson}
        placeholder={t('ticket.addPerson')}
        aria-label={t('ticket.addPerson')}
      />
      <button type="submit" disabled={!newPerson.trim()}>+</button>
    </form>
    <div class="lx-form-grid">
      <label class="lx-field"
        ><span class="lx-field-label">{t('settings.me')}</span>
        <select bind:value={me} onchange={saveTeam}>
          {#each team as name (name)}<option value={name}>{name}</option>{/each}
        </select></label
      >
      <label class="lx-field"
        ><span class="lx-field-label">{t('settings.defaultAssignee')}</span>
        <select bind:value={defaultAssignee} onchange={saveTeam}>
          <option value="">—</option>
          {#each team as name (name)}<option value={name}>{name}</option>{/each}
        </select></label
      >
    </div>
  </Section>

  <Section title={t('settings.integrations')}>
    <p class="lx-muted lx-small">{t('settings.secretsDesc')}</p>
    {#if !api.secrets.available}
      <p class="lx-callout lx-tone-warn">{t('settings.secretsUnavailable')}</p>
    {:else}
      {#each SECRETS as sec (sec.id)}
        {#key revision}
          <div class="lx-secret-row">
            <div>
              <strong>{sec.label}</strong>
              <div class="lx-small" class:lx-muted={!api.secrets.has(sec.id)}>
                {api.secrets.has(sec.id)
                  ? `✓ ${t('settings.secretSaved', { hint: api.secrets.hint(sec.id) })}`
                  : t('settings.secretEmpty')}
              </div>
            </div>
            <form
              class="lx-inline-form"
              onsubmit={(e) => {
                e.preventDefault();
                saveSecret(sec.id);
              }}
            >
              <input
                type="password"
                autocomplete="off"
                spellcheck="false"
                placeholder={api.secrets.has(sec.id) ? '••••••••' : sec.label}
                aria-label={sec.label}
                bind:value={drafts[sec.id]}
              />
              <button type="submit" disabled={!(drafts[sec.id] ?? '').trim()}
                >{t('common.save')}</button
              >
              {#if api.secrets.has(sec.id)}
                <button
                  type="button"
                  class="mod-warning"
                  onclick={() => clearSecret(sec.id, sec.label)}
                  >{t('settings.secretRemove')}</button
                >
              {/if}
            </form>
          </div>
        {/key}
      {/each}
      <p class="lx-muted lx-small">{t('settings.notUsedYet')}</p>
    {/if}
  </Section>

  <Section title={t('settings.more')}>
    <p class="lx-muted lx-small">{t('settings.moreDesc')}</p>
    <button type="button" onclick={() => api.openPluginSettings()}
      >{t('settings.openObsidian')}</button
    >
  </Section>
</div>
