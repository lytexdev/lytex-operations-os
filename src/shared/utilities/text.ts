/** Normalize text for search / duplicate detection: lowercase, strip diacritics and punctuation. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9@.+]+/g, ' ')
    .trim();
}

/** Safe file name segment (no path separators or characters Obsidian rejects). */
export function safeFileName(text: string, max = 80): string {
  const cleaned = text
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
  return cleaned || 'Untitled';
}

export function stripLegalForm(name: string): string {
  return normalize(name)
    .replace(/\b(gmbh|ug|ag|kg|ohg|gbr|e ?k|e ?v|mbh|co|inc|ltd|llc|haftungsbeschrankt)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Levenshtein distance, capped for performance. */
export function levenshtein(a: string, b: string, cap = 10): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const prev = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    let rowMin = prev[0];
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
      rowMin = Math.min(rowMin, prev[j]!);
    }
    if (rowMin > cap) return cap + 1;
  }
  return prev[b.length]!;
}
