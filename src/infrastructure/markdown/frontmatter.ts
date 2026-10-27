import { parse, stringify } from 'yaml';
import { msg } from '@/shared/i18n';

export interface ParsedNote {
  data: Record<string, unknown> | null;
  body: string;
  error: string | null;
  hasFrontmatter: boolean;
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export function parseNote(text: string): ParsedNote {
  const src = text.replace(/^\uFEFF/, '');
  const m = FM_RE.exec(src);
  if (!m) {
    if (src.startsWith('---'))
      return {
        data: null,
        body: src,
        error: msg(
          'Frontmatter nicht abgeschlossen (fehlendes ---)',
          'Frontmatter not closed (missing ---)',
        ),
        hasFrontmatter: true,
      };
    return { data: null, body: src, error: null, hasFrontmatter: false };
  }
  const body = src.slice(m[0].length);
  try {
    const data: unknown = parse(m[1] ?? '', {
      schema: 'core',
      uniqueKeys: true,
      prettyErrors: false,
    });
    if (data === null || data === undefined)
      return { data: {}, body, error: null, hasFrontmatter: true };
    if (typeof data !== 'object' || Array.isArray(data))
      return {
        data: null,
        body,
        error: msg('Frontmatter ist kein Objekt', 'Frontmatter is not an object'),
        hasFrontmatter: true,
      };
    return { data: data as Record<string, unknown>, body, error: null, hasFrontmatter: true };
  } catch (e) {
    return {
      data: null,
      body,
      error: `${msg('YAML-Fehler', 'YAML error')}: ${(e as Error).message.split('\n')[0]}`,
      hasFrontmatter: true,
    };
  }
}

/** Serialize frontmatter deterministically (key order as given). `undefined` values are dropped. */
export function serializeNote(data: Record<string, unknown>, body: string): string {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) if (v !== undefined) clean[k] = v;
  const yaml = stringify(clean, {
    lineWidth: 0,
    indent: 2,
    defaultStringType: 'PLAIN',
    defaultKeyType: 'PLAIN',
    nullStr: 'null',
  }).trimEnd();
  const b = body.startsWith('\n') ? body : `\n${body}`;
  return `---\n${yaml}\n---\n${b.replace(/^\n+/, '\n')}`;
}
