'use client';

import { Badge } from '@/components/settings/ui';

/** A line diff as stored by the API (activity entries, page versions). */
export interface LineDiff {
  added: number;
  removed: number;
  lines: { t: ' ' | '+' | '-' | '…'; s: string }[];
  truncated: boolean;
}

const DIFF_STYLE = {
  '+': 'bg-success/12 text-success',
  '-': 'bg-danger/10 text-danger line-through decoration-danger/40',
  ' ': 'text-ink-2',
  '…': 'text-ink-3',
} as const;

/** What changed in the text during an editing session: removed lines in red, added in green. */
export function DiffView({ diff, title = 'What changed' }: { diff: LineDiff; title?: string }) {
  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        {title}
        <Badge tone="success">+{diff.added}</Badge>
        <Badge tone="danger">−{diff.removed}</Badge>
      </div>
      <div className="max-h-80 overflow-auto rounded-2xl bg-surface-2/60 py-2 font-mono text-[0.8125rem] leading-relaxed">
        {diff.lines.map((l, i) =>
          l.t === '…' ? (
            <div key={i} className="px-4 text-center text-ink-3">
              ⋯
            </div>
          ) : (
            <div key={i} className={`flex gap-3 whitespace-pre-wrap break-words px-4 ${DIFF_STYLE[l.t]}`}>
              <span className="w-3 shrink-0 select-none text-ink-3">{l.t === ' ' ? '' : l.t === '-' ? '−' : '+'}</span>
              <span className="min-w-0 flex-1">{l.s || ' '}</span>
            </div>
          ),
        )}
        {diff.lines.length === 0 && <p className="px-4 text-ink-3">Only formatting changed.</p>}
      </div>
      {diff.truncated && <p className="mt-1.5 text-meta text-ink-3">Long change — only the first part is shown.</p>}
      <p className="mt-1.5 text-meta text-ink-3">Text only; formatting and images aren&apos;t compared.</p>
    </div>
  );
}

