import type { UiApi } from '../stores/ui-api';

/**
 * Svelte action rendering Markdown with Obsidian's renderer (same output as reading view:
 * wiki links, embedded images, callouts …). Re-renders when the text changes.
 */
export function markdown(
  node: HTMLElement,
  params: { api: UiApi; text: string; sourcePath: string },
) {
  let cleanup: (() => void) | null = null;
  let current = params;
  const render = async () => {
    cleanup?.();
    cleanup = await current.api.renderMarkdown(node, current.text, current.sourcePath);
  };
  void render();
  return {
    update(next: { api: UiApi; text: string; sourcePath: string }) {
      if (next.text === current.text && next.sourcePath === current.sourcePath) return;
      current = next;
      void render();
    },
    destroy() {
      cleanup?.();
    },
  };
}
