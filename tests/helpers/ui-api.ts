import { readable, writable } from 'svelte/store';
import type { UiApi, FormRequest } from '@/ui/stores/ui-api';
import { Router } from '@/ui/navigation/router';
import type { TestEnv } from './fixtures';
import type { TimerSession } from '@/domain/services/timer';

/** UiApi backed by an in-memory test core; records notifications, forms and confirms. */
export function makeUiApi(env: TestEnv, opts: { confirm?: boolean } = {}) {
  const version = writable(0);
  const timer = writable<TimerSession | null>(env.core.timer.session);
  env.core.index.subscribe(() => version.update((v) => v + 1));
  env.core.timer.subscribe((s) => timer.set(s));
  const log = {
    notices: [] as { message: string; kind: string }[],
    forms: [] as FormRequest[],
    confirms: [] as string[],
  };
  const api: UiApi = {
    core: env.core,
    ctx: env.core.ctx,
    settings: () => env.settings,
    version: { subscribe: version.subscribe },
    timer: { subscribe: timer.subscribe },
    now: readable(env.clock.now()),
    router: new Router(),
    openNote: () => undefined,
    notify: (message, kind = 'info') => void log.notices.push({ message, kind }),
    confirm: async (title) => {
      log.confirms.push(title);
      return opts.confirm ?? true;
    },
    run: async (fn, success) => {
      try {
        const r = await fn();
        if (success) log.notices.push({ message: success, kind: 'success' });
        return r;
      } catch (e) {
        log.notices.push({ message: (e as Error).message, kind: 'error' });
        return undefined;
      }
    },
    openForm: (req) => void log.forms.push(req),
    startTimer: async (ctx) => {
      await api.run(() =>
        env.core.timer.start({
          ticket_id: null,
          customer_id: null,
          service_id: null,
          description: '',
          billable: true,
          ...ctx,
        }),
      );
    },
    stopTimer: async () => {
      await api.run(() => env.core.timer.stop({ allowShort: true }));
    },
    openTimerPanel: () => undefined,
    openRecovery: () => undefined,
    pickEntity: async () => null,
    saveSettings: async () => undefined,
    renderMarkdown: async (el, md) => {
      el.textContent = md;
      return () => undefined;
    },
    saveAttachment: async (_p, file) => `Attachments/${file.name}`,
    secrets: {
      available: false,
      has: () => false,
      hint: () => '',
      set: () => undefined,
      clear: () => undefined,
    },
    openPluginSettings: () => undefined,
  };
  return { api, log };
}
