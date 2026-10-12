'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MyReviewRequest, ReviewRequest } from '@trigon/shared';
import { Check, CircleCheck, Loader2, MessageSquareText, Search, Send, UserCheck, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { DocIcon, relativeTime } from '@/components/ui/doc-icon';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';

export const useDocReviewRequests = (documentId: string) =>
  useQuery({ queryKey: ['review-requests', documentId], queryFn: () => api<ReviewRequest[]>(`/documents/${documentId}/review-requests`) });

export const useMyReviewRequests = () =>
  useQuery({ queryKey: ['review-requests', 'mine'], queryFn: () => api<MyReviewRequest[]>('/review-requests/mine'), staleTime: 30_000 });

function useRefreshReviews(documentId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['review-requests'] });
    qc.invalidateQueries({ queryKey: ['document', documentId] });
    qc.invalidateQueries({ queryKey: ['health'] });
    qc.invalidateQueries({ queryKey: ['recent'] });
  };
}

type Person = { id: string; email: string; displayName: string; avatarUrl: string | null };

/** "Ask for review": pick a colleague, add a note, send. Offers to share the item when they can't open it. */
export function AskReviewSheet({ open, onOpenChange, documentId, title }: { open: boolean; onOpenChange: (v: boolean) => void; documentId: string; title: string }) {
  const { user } = useSession();
  const refresh = useRefreshReviews(documentId);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Person | null>(null);
  const [message, setMessage] = useState('');
  const term = q.trim();
  const people = useQuery({
    queryKey: ['review-people', term],
    enabled: open && !picked && term.length > 1,
    queryFn: () => api<Person[]>(`/users?q=${encodeURIComponent(term)}`),
  });
  const ask = useMutation({
    mutationFn: (shareAccess: boolean) =>
      api<ReviewRequest>(`/documents/${documentId}/review-requests`, { method: 'POST', json: { reviewerId: picked!.id, message: message.trim() || undefined, shareAccess } }),
    onSuccess: () => {
      refresh();
      setTimeout(() => close(false), 1200);
    },
  });
  const close = (v: boolean) => {
    if (!v) {
      setQ('');
      setPicked(null);
      setMessage('');
      ask.reset();
    }
    onOpenChange(v);
  };
  const errorBody = ask.error instanceof ApiError ? (ask.error.body as { code?: string; canShare?: boolean } | undefined) : undefined;
  const canShare = errorBody?.code === 'no_access' && !!errorBody.canShare;

  return (
    <BottomSheet open={open} onOpenChange={close} title="Ask for review" description={`Someone checks “${title}” and approves it or asks for changes. They get an email and see it on their home page.`}>
      {ask.isSuccess ? (
        <p className="flex items-center gap-2 rounded-xl bg-success/10 px-4 py-3 text-sm font-semibold text-success">
          <CircleCheck className="size-4" /> Sent to {picked?.displayName}.
        </p>
      ) : (
        <div className="space-y-4">
          {picked ? (
            <div className="flex items-center gap-3 rounded-xl bg-surface-2 px-3 py-2.5">
              <Avatar name={picked.displayName} src={picked.avatarUrl} size={34} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{picked.displayName}</span>
                <span className="block truncate text-meta text-ink-3">{picked.email}</span>
              </span>
              <button
                onClick={() => {
                  setPicked(null);
                  ask.reset();
                }}
                className="rounded-full p-1.5 text-ink-3 hover:bg-surface-3 hover:text-ink"
                aria-label="Choose someone else"
              >
                <X className="size-4" />
              </button>
            </div>
          ) : (
            <div>
              <label className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 ring-accent focus-within:ring-2">
                <Search className="size-4 shrink-0 text-ink-3" />
                <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search for a person, e.g. your manager" className="min-w-0 flex-1 bg-transparent py-2.5 outline-none" />
                {people.isFetching && <Loader2 className="size-4 animate-spin text-ink-3" />}
              </label>
              {!!people.data?.length && (
                <div className="mt-1.5 overflow-hidden rounded-xl border border-line">
                  {people.data
                    .filter((p) => p.id !== user?.id)
                    .slice(0, 8)
                    .map((p) => (
                      <button key={p.id} onClick={() => setPicked(p)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-2">
                        <Avatar name={p.displayName} src={p.avatarUrl} size={28} />
                        <span className="min-w-0 flex-1 truncate text-sm">
                          <b className="font-semibold">{p.displayName}</b> <span className="text-ink-3">· {p.email}</span>
                        </span>
                      </button>
                    ))}
                </div>
              )}
              {term.length > 1 && people.data?.length === 0 && <p className="mt-2 text-sm text-ink-3">Nobody found.</p>}
            </div>
          )}

          <label className="block">
            <span className="text-sm font-semibold">Message (optional)</span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={1000}
              rows={3}
              placeholder="What should they check? e.g. the rollback steps"
              className="mt-1.5 w-full resize-none rounded-xl bg-surface-2 px-3.5 py-2.5 text-sm outline-none ring-accent focus:ring-2"
            />
          </label>

          {ask.error && (
            <div className="rounded-xl bg-warning/12 px-3.5 py-3 text-sm">
              <p>{ask.error.message}</p>
              {canShare && (
                <button onClick={() => ask.mutate(true)} className="mt-2 font-semibold text-accent">
                  Share view access with {picked?.displayName.split(' ')[0]} and send
                </button>
              )}
            </div>
          )}

          <button
            disabled={!picked || ask.isPending}
            onClick={() => ask.mutate(false)}
            className="press inline-flex w-full items-center justify-center gap-2 rounded-pill bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink disabled:opacity-50"
          >
            {ask.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Send review request
          </button>
        </div>
      )}
    </BottomSheet>
  );
}

const STATUS_TEXT = { approved: 'Approved', changes_requested: 'Changes requested', cancelled: 'Cancelled', pending: 'Waiting' } as const;

/** Under "Review" in the details panel: who was asked, their answers, and the "Ask for review" button. */
export function ReviewersRow({ documentId, title, canAsk, canManage }: { documentId: string; title: string; canAsk: boolean; canManage: boolean }) {
  const { user } = useSession();
  const { data } = useDocReviewRequests(documentId);
  const refresh = useRefreshReviews(documentId);
  const [open, setOpen] = useState(false);
  const cancel = useMutation({ mutationFn: (id: string) => api(`/review-requests/${id}/cancel`, { method: 'POST' }), onSuccess: refresh });

  return (
    <div className="mt-2 space-y-1.5">
      {data?.map((r) => (
        <div key={r.id} className="flex items-start gap-2 text-meta">
          <Avatar name={r.reviewer.name} size={20} />
          <span className="min-w-0 flex-1">
            <span className="font-semibold text-ink">{r.reviewer.name}</span>{' '}
            <span className={r.status === 'approved' ? 'text-success' : r.status === 'changes_requested' ? 'text-warning' : 'text-ink-3'}>
              · {STATUS_TEXT[r.status]} {relativeTime(r.respondedAt ?? r.createdAt)}
            </span>
            {r.response && <span className="block text-ink-2">“{r.response}”</span>}
          </span>
          {r.status === 'pending' && (r.requestedBy?.id === user?.id || canManage) && (
            <button onClick={() => cancel.mutate(r.id)} className="rounded-full p-0.5 text-ink-3 hover:text-danger" aria-label={`Cancel review by ${r.reviewer.name}`} title="Cancel this request">
              <X className="size-3.5" />
            </button>
          )}
        </div>
      ))}
      {canAsk && (
        <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 text-meta font-semibold text-accent">
          <UserCheck className="size-3.5" /> Ask for review
        </button>
      )}
      <AskReviewSheet open={open} onOpenChange={setOpen} documentId={documentId} title={title} />
    </div>
  );
}

/** Shown on the item to the person asked: approve, or request changes with a note. */
export function ReviewBanner({ documentId }: { documentId: string }) {
  const { user } = useSession();
  const { data } = useDocReviewRequests(documentId);
  const refresh = useRefreshReviews(documentId);
  const [mode, setMode] = useState<'idle' | 'approve' | 'changes'>('idle');
  const [note, setNote] = useState('');
  const mine = data?.find((r) => r.status === 'pending' && r.reviewer.id === user?.id);
  const answer = useMutation({
    mutationFn: (kind: 'approve' | 'request-changes') => api(`/review-requests/${mine!.id}/${kind}`, { method: 'POST', json: { note: note.trim() || undefined } }),
    onSuccess: () => {
      setMode('idle');
      setNote('');
      refresh();
    },
  });
  if (!mine) return null;

  return (
    <div className="rounded-2xl border border-accent/40 bg-accent-soft/50 p-4">
      <div className="flex items-start gap-3">
        <Avatar name={mine.requestedBy?.name ?? '?'} size={34} />
        <div className="min-w-0 flex-1">
          <p className="text-sm">
            <b>{mine.requestedBy?.name ?? 'Someone'}</b> asked you to review this · {relativeTime(mine.createdAt)}
          </p>
          {mine.message && (
            <p className="mt-1 flex items-start gap-1.5 text-sm text-ink-2">
              <MessageSquareText className="mt-0.5 size-4 shrink-0 text-ink-3" /> “{mine.message}”
            </p>
          )}
        </div>
      </div>
      {mode === 'idle' ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => setMode('approve')} className="press inline-flex items-center gap-1.5 rounded-pill bg-accent px-4 py-2 text-sm font-semibold text-accent-ink">
            <Check className="size-4" /> Approve
          </button>
          <button onClick={() => setMode('changes')} className="press inline-flex items-center gap-1.5 rounded-pill bg-surface px-4 py-2 text-sm font-semibold shadow-card">
            Request changes
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <textarea
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder={mode === 'approve' ? 'Comment (optional)' : 'What should be changed?'}
            className="w-full resize-none rounded-xl bg-surface px-3.5 py-2.5 text-sm outline-none ring-accent focus:ring-2"
          />
          <div className="flex flex-wrap gap-2">
            <button
              disabled={answer.isPending || (mode === 'changes' && !note.trim())}
              onClick={() => answer.mutate(mode === 'approve' ? 'approve' : 'request-changes')}
              className="press inline-flex items-center gap-1.5 rounded-pill bg-accent px-4 py-2 text-sm font-semibold text-accent-ink disabled:opacity-50"
            >
              {answer.isPending && <Loader2 className="size-4 animate-spin" />}
              {mode === 'approve' ? 'Approve and mark verified' : 'Send request for changes'}
            </button>
            <button onClick={() => setMode('idle')} className="rounded-pill px-4 py-2 text-sm font-semibold text-ink-3 hover:text-ink">
              Back
            </button>
          </div>
          <p className="text-meta text-ink-3">
            {mode === 'approve' ? 'The item is marked verified in your name and the requester is told.' : 'The item goes back to draft and the requester gets your note.'}
          </p>
        </div>
      )}
      {answer.error && <p className="mt-2 text-sm text-danger">{answer.error.message}</p>}
    </div>
  );
}

/** Home page / Review list: everything waiting for my review. */
export function ReviewInbox({ limit, empty = 'Nothing waiting for you.' }: { limit?: number; empty?: string }) {
  const { data, isPending } = useMyReviewRequests();
  const items = limit ? data?.slice(0, limit) : data;
  if (isPending) return <div className="h-16 animate-pulse rounded-xl bg-surface-2" />;
  if (!items?.length) return <p className="py-3 text-sm text-ink-3">{empty}</p>;
  return (
    <ul>
      {items.map((r, i) => (
        <li key={r.id}>
          <Link href={`/d/${r.documentId}`} className={`flex items-center gap-3 py-2.5 hover:text-accent ${i ? 'border-t border-line' : ''}`}>
            <DocIcon kind={r.document.kind} mimeType={r.document.mimeType} title={r.document.title} emoji={r.document.icon} pageType={r.document.pageType} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{r.document.title}</span>
              <span className="block truncate text-meta text-ink-3">
                {r.requestedBy?.name ?? 'Someone'} · {relativeTime(r.createdAt)} · {r.document.spaceName}
              </span>
              {r.message && <span className="block truncate text-meta text-ink-2">“{r.message}”</span>}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
