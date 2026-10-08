'use client';

import { CircleAlert, PencilLine } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/shell/page-header';
import { CustomIcon, relativeTime } from '@/components/ui/doc-icon';
import { StatusBadge } from '@/components/ui/status-badge';
import { useHealth } from '@/lib/queries';

/** Review queue: pages whose verification has expired, and drafts waiting to be verified. */
export default function ReviewPage() {
  const { data, isPending } = useHealth();
  return (
    <>
      <PageHeader title="Review" subtitle={data ? `${data.stale} need review · ${data.drafts} drafts` : undefined} />
      <div className="mx-auto max-w-3xl px-4 pb-12 md:px-8">
        <div className="overflow-hidden rounded-card bg-surface shadow-card">
          {isPending && <div className="h-40 animate-pulse" />}
          {data?.needsReview.length === 0 && <p className="p-10 text-center text-ink-3">Nothing to review — every page is verified and current.</p>}
          {data?.needsReview.map((d, i) => (
            <Link key={d.id} href={`/d/${d.id}`} className={`press flex items-center gap-3 px-4 py-3 hover:bg-surface-2/60 ${i ? 'border-t border-line' : ''}`}>
              {d.icon ? (
                <CustomIcon icon={d.icon} />
              ) : (
                <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${d.status === 'stale' ? 'bg-danger/10 text-danger' : 'bg-warning/15 text-warning'}`}>
                  {d.status === 'stale' ? <CircleAlert className="size-5" /> : <PencilLine className="size-5" />}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{d.title}</span>
                <span className="block truncate text-meta text-ink-3">
                  {d.spaceName} · {d.status === 'stale' ? `verified ${relativeTime(d.since)}` : `edited ${relativeTime(d.since)}`}
                </span>
              </span>
              <StatusBadge status={d.status} compact />
            </Link>
          ))}
        </div>
        <p className="mt-3 px-1 text-meta text-ink-3">Oldest first. Pages become “needs review” when their review interval passes (default 6 months).</p>
      </div>
    </>
  );
}
