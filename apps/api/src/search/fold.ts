/**
 * Search folding, kept identical to the SQL function trigon_fold() (migration 0010):
 * lower-case, strip combining accents (U+0300–U+036F) and treat final sigma as σ.
 * "ΑΘΗΝΑΣ", "Αθήνας" and "αθηνας" all fold to "αθηνασ"; "Café" to "cafe".
 */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ς/g, 'σ');
}

/** Words of a search box entry, folded, at most 8. */
export function searchWords(q: string): string[] {
  return (fold(q).match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 8);
}

/**
 * A short excerpt of `text` around the first matched word, with every word that starts with one of
 * `words` wrapped in <mark> (same format the search page already renders). `text` is a window the
 * database cut around the match; it is trimmed to whole words here.
 */
export function snippet(text: string, words: string[], cutStart: boolean, cutEnd: boolean, maxWords = 24): string {
  if (!text) return '';
  // Fold character by character so positions map back to the original (accents and all).
  const chars = Array.from(text);
  const folded: string[] = chars.map((c) => fold(c));
  const tokens: { start: number; end: number; word: string }[] = [];
  let i = 0;
  while (i < chars.length) {
    if (!/[\p{L}\p{N}]/u.test(chars[i])) {
      i++;
      continue;
    }
    const start = i;
    while (i < chars.length && /[\p{L}\p{N}\p{M}]/u.test(chars[i])) i++;
    tokens.push({ start, end: i, word: folded.slice(start, i).join('') });
  }
  if (!tokens.length) return '';
  // Drop a word the database window may have cut in half at either edge.
  if (cutStart && tokens.length > 1) tokens.shift();
  if (cutEnd && tokens.length > 1) tokens.pop();
  const hit = (w: string) => words.some((q) => w.startsWith(q));
  const first = Math.max(0, tokens.findIndex((t) => hit(t.word)));
  const from = Math.max(0, first - 6);
  const shown = tokens.slice(from, from + maxWords);
  let out = '';
  for (let t = 0; t < shown.length; t++) {
    const tok = shown[t];
    const word = chars.slice(tok.start, tok.end).join('');
    out += hit(tok.word) ? `<mark>${word}</mark>` : word;
    if (t < shown.length - 1) out += chars.slice(tok.end, shown[t + 1].start).join('').replace(/\s+/g, ' ');
  }
  const lead = cutStart || from > 0 ? '… ' : '';
  const tail = cutEnd || from + maxWords < tokens.length ? ' …' : '';
  return lead + out.trim() + tail;
}
