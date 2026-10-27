<script lang="ts">
  import type { UiApi } from '../stores/ui-api';
  import { t } from '@/shared/i18n';
  import { insertAt } from '../forms/form-utils';
  import { markdown } from './markdown';

  /** Markdown textarea with preview and image upload (button, paste, drag & drop). */
  let {
    api,
    value = $bindable(''),
    projectId,
    sourcePath = '',
    rows = 8,
  }: {
    api: UiApi;
    value?: string;
    projectId: string | null;
    sourcePath?: string;
    rows?: number;
  } = $props();
  let preview = $state(false);
  let busy = $state(false);
  let textarea: HTMLTextAreaElement | undefined = $state();
  let fileInput: HTMLInputElement | undefined = $state();

  async function addFiles(files: File[]) {
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (!images.length) return;
    if (!projectId) {
      api.notify(t('md.needProject'), 'error');
      return;
    }
    busy = true;
    for (const file of images) {
      const path = await api.run(() => api.saveAttachment(projectId, file));
      if (!path) continue;
      const start = textarea?.selectionStart ?? value.length;
      const end = textarea?.selectionEnd ?? value.length;
      const r = insertAt(value, start, end, `![[${path}]]\n`);
      value = r.value;
      queueMicrotask(() => textarea?.setSelectionRange(r.cursor, r.cursor));
    }
    busy = false;
  }

  function onPaste(e: ClipboardEvent) {
    const files = [...(e.clipboardData?.files ?? [])];
    if (files.some((f) => f.type.startsWith('image/'))) {
      e.preventDefault();
      void addFiles(files);
    }
  }
  function onDrop(e: DragEvent) {
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length) {
      e.preventDefault();
      void addFiles(files);
    }
  }
</script>

<div class="lx-md-editor">
  <div class="lx-md-toolbar">
    <div class="lx-segmented" role="group">
      <button type="button" class:is-active={!preview} onclick={() => (preview = false)}
        >{t('md.write')}</button
      >
      <button type="button" class:is-active={preview} onclick={() => (preview = true)}
        >{t('md.preview')}</button
      >
    </div>
    <button
      type="button"
      disabled={busy || !projectId}
      onclick={() => fileInput?.click()}
      title={projectId ? '' : t('md.needProject')}>🖼 {t('md.addImage')}</button
    >
    <input
      bind:this={fileInput}
      type="file"
      accept="image/*"
      multiple
      hidden
      onchange={(e) => {
        const el = e.currentTarget as HTMLInputElement;
        void addFiles([...(el.files ?? [])]);
        el.value = '';
      }}
    />
    <span class="lx-muted lx-small">{busy ? t('md.uploading') : t('md.hint')}</span>
  </div>
  {#if preview}
    <div
      class="lx-md-preview markdown-rendered"
      use:markdown={{ api, text: value || '—', sourcePath }}
    ></div>
  {:else}
    <textarea
      bind:this={textarea}
      bind:value
      {rows}
      onpaste={onPaste}
      ondrop={onDrop}
      ondragover={(e) => e.preventDefault()}
      aria-label={t('common.description')}></textarea>
  {/if}
</div>
