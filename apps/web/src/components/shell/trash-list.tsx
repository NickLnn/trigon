'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TrashItem } from '@trigon/shared';
import { Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { DocIcon, relativeTime } from '@/components/ui/doc-icon';
import { api } from '@/lib/api';
import { useSpaces } from '@/lib/queries';

const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/**
 * Deleted items waiting in the trash, for one space or (without `spaceId`) every space the person can
 * edit. Editors restore; people with full access to the space can delete for good.
 */
export function TrashList({ spaceId }: { spaceId?: string }) {
  const qc = useQueryClient();
  const { data: spaces } = useSpaces();
  const { data, isPending, error } = useQuery({
    queryKey: ['trash', spaceId ?? 'all'],
    queryFn: () => api<TrashItem[]>(spaceId ? `/spaces/${spaceId}/trash` : '/trash'),
  });
  const [confirmPurge, setConfirmPurge] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['trash'] });
    qc.invalidateQueries({ queryKey: ['tree'] });
    qc.invalidateQueries({ queryKey: ['space-stats'] });
    qc.invalidateQueries({ queryKey: ['recent'] });
  };
  const restore = useMutation({
    mutationFn: (item: TrashItem) => api<{ parentId: string | null; restored: number }>(`/documents/${item.id}/restore`, { method: 'POST' }),
    onSuccess: (r, item) => {
      setDone(
        `“${item.title}” is back in ${item.spaceName}${r.restored > 1 ? ` with ${r.restored - 1} item${r.restored === 2 ? '' : 's'} inside` : ''}${
          item.location && !r.parentId ? ' — at the top of the space, because its folder is deleted too' : ''
        }.`,
      );
      refresh();
    },
  });
  const purge = useMutation({
    mutationFn: (id: string) => api(`/documents/${id}/permanent`, { method: 'DELETE' }),
    onSuccess: () => {
      setConfirmPurge(null);
      refresh();
    },
  });
  const canPurge = (item: TrashItem) => spaces?.find((s) => s.id === item.spaceId)?.myPermission === 'manage';

  return (
    <div className="space-y-3">
      {done && <p className="rounded-xl bg-success/10 px-4 py-3 text-sm font-semibold text-success">{done}</p>}
      {(restore.error || purge.error) && <p className="rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">{(restore.error ?? purge.error)!.message}</p>}
      {error && <p className="p-8 text-center text-ink-2">{error.message}</p>}
      <div className="overflow-hidden rounded-card bg-surface shadow-card">
        {isPending && <div className="h-40 animate-pulse" />}
        {data?.length === 0 && (
          <p className="flex flex-col items-center gap-2 p-10 text-center text-ink-3">
            <Trash2 className="size-6" /> The trash is empty.
          </p>
        )}
        {data?.map((item, i) => (
          <div key={item.id} className={`px-4 py-3 ${i ? 'border-t border-line' : ''}`}>
            <div className="flex items-center gap-3">
              <DocIcon kind={item.kind} mimeType={item.mimeType} title={item.title} emoji={item.icon} pageType={item.pageType} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{item.title}</span>
                <span className="block truncate text-meta text-ink-3">
                  Deleted {relativeTime(item.deletedAt)}
                  {item.deletedBy ? ` by ${item.deletedBy}` : ''}
                  {item.inside ? ` · ${item.inside} item${item.inside === 1 ? '' : 's'} inside` : ''}
                </span>
                <span className="block truncate text-meta text-ink-3">
                  From {spaceId ? '' : `${item.spaceName} › `}
                  {item.location ?? 'top of the space'} · removed for good on {date(item.purgeAt)}
                </span>
              </span>
              <button
                disabled={restore.isPending}
                onClick={() => restore.mutate(item)}
                className="press inline-flex shrink-0 items-center gap-1.5 rounded-pill bg-accent px-3.5 py-2 text-sm font-semibold text-accent-ink disabled:opacity-60"
              >
                {restore.isPending && restore.variables?.id === item.id ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
                <span className="hidden sm:inline">Restore</span>
              </button>
              {canPurge(item) && (
                <button
                  onClick={() => setConfirmPurge(item.id)}
                  className="press grid size-9 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-danger/10 hover:text-danger"
                  aria-label={`Delete ${item.title} for good`}
                  title="Delete for good"
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
            {confirmPurge === item.id && (
              <div className="mt-3 rounded-xl bg-danger/10 p-3 text-sm">
                <p>
                  Delete <b>{item.title}</b>
                  {item.inside ? ` and the ${item.inside} item${item.inside === 1 ? '' : 's'} inside it` : ''} for good? Its history and files are removed too. This can&apos;t be undone.
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    disabled={purge.isPending}
                    onClick={() => purge.mutate(item.id)}
                    className="press inline-flex items-center gap-1.5 rounded-pill bg-danger px-3.5 py-1.5 font-semibold text-white disabled:opacity-60"
                  >
                    {purge.isPending && <Loader2 className="size-4 animate-spin" />} Delete for good
                  </button>
                  <button onClick={() => setConfirmPurge(null)} className="rounded-pill px-3.5 py-1.5 font-semibold text-ink-2">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="px-1 text-meta text-ink-3">
        Deleted items are kept for 30 days. Anyone who can edit a space can restore its items; only people with full access can delete them for good.
      </p>
    </div>
  );
}
