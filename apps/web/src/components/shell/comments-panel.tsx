'use client';

import { COMMENT_MAX, type CommentItem, type CommentThread } from '@trigon/shared';
import { Check, Loader2, MessageSquare, MessageSquarePlus, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { CommentAnchor } from '@/components/editor/extensions/comments';
import { Avatar } from '@/components/ui/avatar';
import { relativeTime } from '@/components/ui/doc-icon';
import { useComments, useDeleteComment, useEditComment, useReply, useResolve, useStartThread } from '@/lib/comments';

/** A textarea that grows with its text; Ctrl/⌘+Enter sends, Escape cancels. */
function Composer({
  placeholder,
  submitLabel,
  busy,
  error,
  initial = '',
  autoFocus,
  onSubmit,
  onCancel,
}: {
  placeholder: string;
  submitLabel: string;
  busy: boolean;
  error?: string | null;
  initial?: string;
  autoFocus?: boolean;
  onSubmit: (body: string) => Promise<unknown> | void;
  onCancel?: () => void;
}) {
  const [body, setBody] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [body]);
  const send = async () => {
    if (!body.trim() || busy) return;
    try {
      await onSubmit(body);
      setBody('');
    } catch {
      /* the error is shown below */
    }
  };
  return (
    <div className="space-y-2">
      <textarea
        ref={ref}
        value={body}
        autoFocus={autoFocus}
        rows={2}
        maxLength={COMMENT_MAX}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void send();
          }
          if (e.key === 'Escape' && onCancel) onCancel();
        }}
        placeholder={placeholder}
        className="block w-full resize-none rounded-xl bg-surface-2 px-3 py-2 text-sm outline-none ring-accent placeholder:text-ink-3 focus:ring-2"
      />
      {error && <p className="text-meta text-danger">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        {onCancel && (
          <button type="button" onClick={onCancel} className="press rounded-pill px-3 py-1.5 text-meta font-semibold text-ink-2 hover:bg-surface-2">
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={() => void send()}
          disabled={!body.trim() || busy}
          className="press inline-flex items-center gap-1.5 rounded-pill bg-accent px-3.5 py-1.5 text-meta font-semibold text-accent-ink disabled:opacity-50"
        >
          {busy && <Loader2 className="size-3.5 animate-spin" />}
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

function Comment({ documentId, comment }: { documentId: string; comment: CommentItem }) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const edit = useEditComment(documentId);
  const remove = useDeleteComment(documentId);
  const name = comment.author?.name ?? 'Former member';
  return (
    <div className="flex gap-2.5">
      <Avatar name={name} size={26} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-1.5 text-meta">
          <span className="font-semibold text-ink">{name}</span>
          <span className="text-ink-3" title={new Date(comment.createdAt).toLocaleString()}>
            {relativeTime(comment.createdAt)}
            {comment.editedAt && ' · edited'}
          </span>
        </div>
        {editing ? (
          <div className="mt-1">
            <Composer
              initial={comment.body}
              autoFocus
              placeholder="Edit your comment"
              submitLabel="Save"
              busy={edit.isPending}
              error={edit.error?.message}
              onSubmit={(body) => edit.mutateAsync({ id: comment.id, body }).then(() => setEditing(false))}
              onCancel={() => setEditing(false)}
            />
          </div>
        ) : (
          <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-ink">{comment.body}</p>
        )}
        {!editing && (comment.canEdit || comment.canDelete) && (
          <div className="mt-1 flex gap-3 text-meta text-ink-3">
            {comment.canEdit && (
              <button type="button" className="hover:text-ink" onClick={() => setEditing(true)}>
                Edit
              </button>
            )}
            {comment.canDelete &&
              (confirmDelete ? (
                <span className="inline-flex gap-2">
                  <button type="button" className="font-semibold text-danger" disabled={remove.isPending} onClick={() => remove.mutate(comment.id)}>
                    {remove.isPending ? 'Deleting…' : 'Delete it'}
                  </button>
                  <button type="button" className="hover:text-ink" onClick={() => setConfirmDelete(false)}>
                    Keep
                  </button>
                </span>
              ) : (
                <button type="button" className="hover:text-ink" onClick={() => setConfirmDelete(true)}>
                  Delete
                </button>
              ))}
          </div>
        )}
        {remove.error && <p className="text-meta text-danger">{remove.error.message}</p>}
      </div>
    </div>
  );
}

function Thread({
  documentId,
  thread,
  active,
  canComment,
  onSelect,
}: {
  documentId: string;
  thread: CommentThread;
  active: boolean;
  canComment: boolean;
  onSelect: (id: string | null) => void;
}) {
  const reply = useReply(documentId);
  const resolve = useResolve(documentId);
  const [replying, setReplying] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const resolved = !!thread.resolvedAt;
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [active]);
  return (
    <article
      ref={ref}
      onClick={() => !active && onSelect(thread.id)}
      className={`rounded-2xl border p-3 transition-colors ${active ? 'border-accent/50 bg-surface shadow-card' : 'border-line bg-surface hover:border-ink-3/40'} ${resolved ? 'opacity-75' : ''}`}
    >
      {thread.quote && (
        <p className="mb-2 line-clamp-3 border-l-2 border-[rgb(230_160_0)] pl-2 text-meta italic text-ink-2">“{thread.quote}”</p>
      )}
      <div className="space-y-3">
        {thread.comments.map((c) => (
          <Comment key={c.id} documentId={documentId} comment={c} />
        ))}
      </div>
      {resolved && (
        <p className="mt-2 text-meta text-ink-3">
          Resolved{thread.resolvedBy ? ` by ${thread.resolvedBy}` : ''} · {relativeTime(thread.resolvedAt!)}
        </p>
      )}
      {canComment && (
        <div className="mt-2.5" onClick={(e) => e.stopPropagation()}>
          {replying ? (
            <Composer
              autoFocus
              placeholder={resolved ? 'Reply (this reopens the discussion)' : 'Reply'}
              submitLabel="Reply"
              busy={reply.isPending}
              error={reply.error?.message}
              onSubmit={(body) => reply.mutateAsync({ threadId: thread.id, body }).then(() => setReplying(false))}
              onCancel={() => setReplying(false)}
            />
          ) : (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  onSelect(thread.id);
                  setReplying(true);
                }}
                className="press rounded-pill px-2.5 py-1 text-meta font-semibold text-ink-2 hover:bg-surface-2"
              >
                Reply
              </button>
              <button
                type="button"
                disabled={resolve.isPending}
                onClick={() => resolve.mutate({ threadId: thread.id, resolved: !resolved }, { onSuccess: () => !resolved && active && onSelect(null) })}
                className="press inline-flex items-center gap-1 rounded-pill px-2.5 py-1 text-meta font-semibold text-ink-2 hover:bg-surface-2"
              >
                {resolved ? <RotateCcw className="size-3.5" /> : <Check className="size-3.5" />}
                {resolved ? 'Reopen' : 'Resolve'}
              </button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

/**
 * A page's discussions: comment on selected text (the editor's Comment button starts a draft) or on the
 * whole page, reply, resolve. Used in the side rail and in a sheet on smaller screens.
 */
export function CommentsPanel({
  documentId,
  activeId,
  onSelect,
  draft,
  onDraftDone,
}: {
  documentId: string;
  activeId: string | null;
  onSelect: (id: string | null) => void;
  draft: CommentAnchor | null;
  onDraftDone: () => void;
}) {
  const { data, error, isPending } = useComments(documentId);
  const start = useStartThread(documentId);
  const [pageComment, setPageComment] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const open = data?.threads.filter((t) => !t.resolvedAt) ?? [];
  const resolved = data?.threads.filter((t) => t.resolvedAt) ?? [];
  // Opening a resolved thread from a link shows the resolved list.
  useEffect(() => {
    if (activeId && resolved.some((t) => t.id === activeId)) setShowResolved(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, data]);

  if (error) return <p className="text-sm text-danger">{error.message}</p>;
  if (isPending || !data) return <div className="h-16 animate-pulse rounded-2xl bg-surface-2" />;

  return (
    <div className="space-y-3">
      {draft && (
        <div className="rounded-2xl border border-accent/40 bg-surface p-3 shadow-card">
          <p className="mb-2 line-clamp-3 border-l-2 border-accent pl-2 text-meta italic text-ink-2">“{draft.quote}”</p>
          <Composer
            autoFocus
            placeholder="Add a comment"
            submitLabel="Comment"
            busy={start.isPending}
            error={start.error?.message}
            onSubmit={(body) =>
              start.mutateAsync({ body, ...draft }).then((r) => {
                onDraftDone();
                onSelect(r.id);
              })
            }
            onCancel={onDraftDone}
          />
        </div>
      )}

      {data.canComment &&
        !draft &&
        (pageComment ? (
          <div className="rounded-2xl border border-line bg-surface p-3">
            <Composer
              autoFocus
              placeholder="Comment on this page"
              submitLabel="Comment"
              busy={start.isPending}
              error={start.error?.message}
              onSubmit={(body) =>
                start.mutateAsync({ body }).then((r) => {
                  setPageComment(false);
                  onSelect(r.id);
                })
              }
              onCancel={() => setPageComment(false)}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setPageComment(true)}
            className="press flex w-full items-center gap-2 rounded-2xl border border-dashed border-line px-3 py-2.5 text-sm text-ink-2 hover:border-ink-3/50 hover:text-ink"
          >
            <MessageSquarePlus className="size-4" /> Comment on this page
          </button>
        ))}

      {data.canComment && !draft && !open.length && (
        <p className="px-1 text-meta text-ink-3">Tip: select text in the page and press Comment to discuss a specific passage.</p>
      )}
      {!data.canComment && !data.threads.length && <p className="px-1 text-sm text-ink-3">No comments yet.</p>}

      {open.map((t) => (
        <Thread key={t.id} documentId={documentId} thread={t} active={t.id === activeId} canComment={data.canComment} onSelect={onSelect} />
      ))}

      {resolved.length > 0 && (
        <div className="pt-1">
          <button type="button" onClick={() => setShowResolved((v) => !v)} className="px-1 text-meta font-semibold text-ink-3 hover:text-ink">
            {showResolved ? 'Hide' : 'Show'} {resolved.length} resolved
          </button>
          {showResolved && (
            <div className="mt-2 space-y-3">
              {resolved.map((t) => (
                <Thread key={t.id} documentId={documentId} thread={t} active={t.id === activeId} canComment={data.canComment} onSelect={onSelect} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Toolbar button that shows how many open discussions a page has. */
export function CommentsButton({ documentId, onClick, active }: { documentId: string; onClick: () => void; active?: boolean }) {
  const { data } = useComments(documentId);
  const open = data?.threads.filter((t) => !t.resolvedAt).length ?? 0;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Comments${open ? ` (${open} open)` : ''}`}
      aria-pressed={active}
      className={`press inline-flex h-9 items-center gap-1.5 rounded-full border border-line px-2.5 text-sm font-semibold ${active ? 'bg-accent-soft text-accent' : 'bg-surface text-ink-2 hover:text-ink'}`}
    >
      <MessageSquare className="size-4" />
      {open > 0 && <span className="tabular-nums">{open}</span>}
    </button>
  );
}

