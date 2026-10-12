/** One line of a diff: ' ' unchanged context, '+' added, '-' removed, '…' skipped unchanged lines. */
export interface DiffLine {
  t: ' ' | '+' | '-' | '…';
  s: string;
}

export interface TextDiff {
  added: number;
  removed: number;
  lines: DiffLine[];
  /** True when the listing was cut to keep the log entry small. */
  truncated: boolean;
}

const CONTEXT = 2;
const MAX_LINES = 400;
const MAX_LINE_CHARS = 500;
/** Beyond this many differing lines the middle is shown as "everything replaced". */
const MAX_EDIT_DISTANCE = 1000;

const split = (text: string) => (text === '' ? [] : text.replace(/\r\n?/g, '\n').split('\n'));

/** Myers' O((N+M)·D) shortest edit script over lines. Returns null when D exceeds the cap. */
function myers(a: string[], b: string[]): DiffLine[] | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, MAX_EDIT_DISTANCE);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, a, b, offset, d);
    }
  }
  return null;
}

function backtrack(trace: Int32Array[], a: string[], b: string[], offset: number, dEnd: number): DiffLine[] {
  const out: DiffLine[] = [];
  let x = a.length;
  let y = b.length;
  for (let d = dEnd; d >= 0; d--) {
    const v = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? k + 1 : k - 1;
    const prevX = v[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      out.push({ t: ' ', s: a[x] });
    }
    if (d > 0) {
      if (x === prevX) out.push({ t: '+', s: b[--y] });
      else out.push({ t: '-', s: a[--x] });
    }
  }
  return out.reverse();
}

/** Line diff of two plain texts, reduced to the changed lines plus a little context. */
export function textDiff(before: string, after: string): TextDiff {
  const a = split(before);
  const b = split(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const middle = myers(midA, midB) ?? [...midA.map((s) => ({ t: '-' as const, s })), ...midB.map((s) => ({ t: '+' as const, s }))];
  const all: DiffLine[] = [...a.slice(0, start).map((s) => ({ t: ' ' as const, s })), ...middle, ...a.slice(endA).map((s) => ({ t: ' ' as const, s }))];

  let added = 0;
  let removed = 0;
  const keep = new Uint8Array(all.length);
  all.forEach((l, i) => {
    if (l.t === ' ') return;
    if (l.t === '+') added++;
    else removed++;
    for (let j = Math.max(0, i - CONTEXT); j <= Math.min(all.length - 1, i + CONTEXT); j++) keep[j] = 1;
  });

  const lines: DiffLine[] = [];
  let truncated = false;
  for (let i = 0; i < all.length; i++) {
    if (!keep[i]) {
      if (lines.length && lines[lines.length - 1].t !== '…') lines.push({ t: '…', s: '' });
      continue;
    }
    if (lines.length >= MAX_LINES) {
      truncated = true;
      break;
    }
    const s = all[i].s.length > MAX_LINE_CHARS ? `${all[i].s.slice(0, MAX_LINE_CHARS)}…` : all[i].s;
    lines.push({ t: all[i].t, s });
  }
  if (lines.length && lines[lines.length - 1].t === '…') lines.pop();
  return { added, removed, lines, truncated };
}
