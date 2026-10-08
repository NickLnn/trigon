import type { DisplayStatus } from '@trigon/shared';
import { CircleAlert, CircleCheck, PencilLine } from 'lucide-react';
import { relativeTime } from './doc-icon';

const STYLES: Record<Exclude<DisplayStatus, 'none'>, { label: string; cls: string; Icon: typeof CircleCheck }> = {
  verified: { label: 'Verified', cls: 'bg-success/12 text-[#0f6e46] dark:text-[#6fdca0]', Icon: CircleCheck },
  draft: { label: 'Draft', cls: 'bg-warning/15 text-[#8a5a00] dark:text-[#ffc56b]', Icon: PencilLine },
  stale: { label: 'Needs review', cls: 'bg-danger/10 text-[#b42318] dark:text-[#ff8f86]', Icon: CircleAlert },
};

/** Review state chip. Renders nothing for pages that aren't in the review workflow. */
export function StatusBadge({ status, since, compact = false }: { status: DisplayStatus | null | undefined; since?: string | null; compact?: boolean }) {
  if (!status || status === 'none') return null;
  const s = STYLES[status];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-pill px-2 py-0.5 text-[0.6875rem] font-semibold ${s.cls}`}>
      {!compact && <s.Icon className="size-3" />}
      {s.label}
      {since && status === 'verified' && !compact && <span className="font-medium opacity-80">· {relativeTime(since)}</span>}
    </span>
  );
}

/** Product / version tag chip. */
export function TagChip({ children }: { children: string }) {
  return <span className="inline-flex items-center rounded-pill bg-surface-2 px-2 py-0.5 text-[0.6875rem] font-semibold text-ink-2">{children}</span>;
}
