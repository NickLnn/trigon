'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { generateHTML } from '@tiptap/core';
import type { DocumentVersion, DocumentVersionDetail } from '@trigon/shared';
import DOMPurify from 'dompurify';
import { ArrowLeft, History, Loader2, RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { contentExtensions } from '@/components/editor/extensions/content';
import { Avatar } from '@/components/ui/avatar';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { DiffView } from '@/components/ui/diff-view';
import { relativeTime } from '@/components/ui/doc-icon';
import { api } from '@/lib/api';

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function VersionDetail({ documentId, id, canRestore, onBack, onRestored }: { documentId: string; id: string; canRestore: boolean; onBack: () => void; onRestored: () => void }) {
  const qc = useQueryClient();
  const { data, isPending } = useQuery({ queryKey: ['version', documentId, id], queryFn: () => api<DocumentVersionDetail>(`/documents/${documentId}/versions/${id}`) });
  const [tab, setTab] = useState<'changes' | 'preview'>('changes');
  const [confirm, setConfirm] = useState(false);
  const restore = useMutation({
    mutationFn: () => api(`/documents/${documentId}/versions/${id}/restore`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['versions', documentId] });
      qc.invalidateQueries({ queryKey: ['document', documentId] });
      qc.invalidateQueries({ queryKey: ['tree'] });
      onRestored();
    },
  });
  const html = useMemo(() => {
    if (!data?.content) return '';
    try {
      // Old versions hold whatever collaborators synced, so the HTML is cleaned before it is injected.
      return DOMPurify.sanitize(generateHTML(data.content, contentExtensions), { FORBID_TAGS: ['iframe', 'form', 'style'], ALLOW_DATA_ATTR: true });
    } catch {
      return '<p><em>This version can’t be shown.</em></p>';
    }
  }, [data?.content]);

  if (isPending || !data) return <div className="h-60 animate-pulse rounded-2xl bg-surface-2" />;
  return (
    <div>
      <button onClick={onBack} className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" /> All versions
      </button>
      <div className="flex items-center gap-3">
        <Avatar name={data.author?.name ?? '?'} size={34} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{data.author?.name ?? 'Unknown'}</p>
          <p className="truncate text-meta text-ink-3">
            {when(data.updatedAt)}
            {data.note ? ` · ${data.note}` : ''}
          </p>
        </div>
        {data.current && <span className="rounded-pill bg-success/12 px-2.5 py-0.5 text-meta font-semibold text-success">Current</span>}
      </div>

      <div className="mt-4 flex gap-1 rounded-pill bg-surface-2 p-1">
        {(['changes', 'preview'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`flex-1 rounded-pill py-1.5 text-sm font-semibold ${tab === t ? 'bg-surface shadow-card' : 'text-ink-3'}`}>
            {t === 'changes' ? 'What changed' : 'Page at this version'}
          </button>
        ))}
      </div>
      {tab === 'changes' ? (
        <DiffView diff={data.diff} title="Compared with the version before" />
      ) : (
        <div className="mt-4 max-h-[50vh] overflow-auto rounded-2xl border border-line p-5">
          <h2 className="mb-3 text-title font-bold">{data.title}</h2>
          <div className="trigon-prose" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      )}

      {canRestore && !data.current && (
        <div className="mt-5">
          {confirm ? (
            <div className="rounded-2xl bg-warning/12 p-4">
              <p className="text-sm">
                The page goes back to how it was on <b>{when(data.updatedAt)}</b>. Everyone who has it open sees the change at once. The current text stays in the history, so you can undo this.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  disabled={restore.isPending}
                  onClick={() => restore.mutate()}
                  className="press inline-flex items-center gap-1.5 rounded-pill bg-accent px-4 py-2 text-sm font-semibold text-accent-ink disabled:opacity-60"
                >
                  {restore.isPending ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />} Restore this version
                </button>
                <button onClick={() => setConfirm(false)} className="rounded-pill px-4 py-2 text-sm font-semibold text-ink-3 hover:text-ink">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setConfirm(true)} className="press inline-flex items-center gap-1.5 rounded-pill bg-surface-2 px-4 py-2 text-sm font-semibold hover:bg-surface-3">
              <RotateCcw className="size-4" /> Restore this version
            </button>
          )}
          {restore.error && <p className="mt-2 text-sm text-danger">{restore.error.message}</p>}
        </div>
      )}
    </div>
  );
}

/** Page history: one entry per editing session, with what changed and a restore button. */
export function VersionHistorySheet({ open, onOpenChange, documentId, canRestore }: { open: boolean; onOpenChange: (v: boolean) => void; documentId: string; canRestore: boolean }) {
  const { data, isPending } = useQuery({ queryKey: ['versions', documentId], queryFn: () => api<DocumentVersion[]>(`/documents/${documentId}/versions`), enabled: open });
  const [selected, setSelected] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const close = (v: boolean) => {
    if (!v) {
      setSelected(null);
      setRestored(false);
    }
    onOpenChange(v);
  };

  return (
    <BottomSheet open={open} onOpenChange={close} title="Version history" description="A version is saved each time someone finishes editing. Pick one to see what changed, or to restore it.">
      {restored && <p className="mb-3 rounded-xl bg-success/10 px-4 py-3 text-sm font-semibold text-success">Restored. The page now shows that version.</p>}
      {selected ? (
        <VersionDetail
          documentId={documentId}
          id={selected}
          canRestore={canRestore}
          onBack={() => setSelected(null)}
          onRestored={() => {
            setSelected(null);
            setRestored(true);
          }}
        />
      ) : isPending ? (
        <div className="h-40 animate-pulse rounded-2xl bg-surface-2" />
      ) : !data?.length ? (
        <p className="flex items-center gap-2 rounded-xl bg-surface-2 px-4 py-3 text-sm text-ink-2">
          <History className="size-4" /> No versions yet — they are saved from the next edit on.
        </p>
      ) : (
        <ul className="overflow-hidden rounded-2xl border border-line">
          {data.map((v, i) => (
            <li key={v.id}>
              <button onClick={() => setSelected(v.id)} className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2 ${i ? 'border-t border-line' : ''}`}>
                <Avatar name={v.author?.name ?? '?'} size={30} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {v.author?.name ?? 'Unknown'}
                    {v.current && <span className="ml-2 rounded-pill bg-success/12 px-2 py-0.5 text-[0.6875rem] font-semibold text-success">Current</span>}
                  </span>
                  <span className="block truncate text-meta text-ink-3" title={when(v.updatedAt)}>
                    {relativeTime(v.updatedAt)}
                    {v.note ? ` · ${v.note}` : ''}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-meta">
                  <span className="text-success">+{v.added}</span> <span className="text-danger">−{v.removed}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </BottomSheet>
  );
}
