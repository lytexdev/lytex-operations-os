export interface CsvOptions {
  delimiter: ';' | ',' | '\t';
  /** Prefix cells that start with = + - @ to prevent formula injection in spreadsheet apps. */
  guardFormulas: boolean;
}

export const DEFAULT_CSV: CsvOptions = { delimiter: ';', guardFormulas: true };

export function csvCell(
  value: string | number | boolean | null | undefined,
  opts: CsvOptions = DEFAULT_CSV,
): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (opts.guardFormulas && /^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = `'${s}`;
  if (s.includes(opts.delimiter) || /["\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(
  header: string[],
  rows: (string | number | boolean | null | undefined)[][],
  opts: CsvOptions = DEFAULT_CSV,
): string {
  const lines = [header, ...rows].map((r) => r.map((c) => csvCell(c, opts)).join(opts.delimiter));
  // BOM so that Excel detects UTF-8; CRLF per RFC 4180.
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

/** Minimal RFC-4180 parser (used for tests and re-import checks). */
export function parseCsv(text: string, delimiter = ';'): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
