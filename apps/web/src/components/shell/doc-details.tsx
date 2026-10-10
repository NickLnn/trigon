'use client';

import type { PageType } from '@trigon/shared';
import { CircleCheck, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { relativeTime } from '@/components/ui/doc-icon';
import { StatusBadge, TagChip } from '@/components/ui/status-badge';
import { usePatchDocumentMeta, useVerifyDocument, type DocumentDetail } from '@/lib/queries';

const TYPES: { key: PageType; label: string }[] = [
  { key: 'page', label: 'Page' },
  { key: 'runbook', label: 'Runbook' },
  { key: 'kb', label: 'KB article' },
];
const INTERVALS = [30, 90, 180, 365, 0]; // 0 = never

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-2">
      <dt className="text-meta text-ink-3">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

/** Review status + verify action, usable in the header and the details panel. */
export function VerifyButton({ doc, compact = false }: { doc: DocumentDetail; compact?: boolean }) {
  const verify = useVerifyDocument(doc.id);
  const canEdit = doc.myPermission === 'edit' || doc.myPermission === 'manage';
  if (!canEdit || doc.kind !== 'page') return null;
  const fresh = doc.status === 'verified';
  return (
    <button
      onClick={() => verify.mutate()}
      disabled={verify.isPending}
      title={fresh ? 'Re-verify: confirm it is still correct and restart the review clock' : 'Mark as verified'}
      className={`press inline-flex items-center gap-1.5 rounded-pill px-3.5 py-2 text-sm font-semibold disabled:opacity-60 ${
        fresh ? 'bg-success/12 text-[#0f6e46] dark:text-[#6fdca0]' : 'bg-accent text-accent-ink'
      }`}
    >
      <CircleCheck className="size-4" />
      {compact ? (fresh ? 'Verified' : 'Verify') : fresh ? 'Re-verify' : 'Mark verified'}
    </button>
  );
}

/** Page metadata: type, review state and interval, tags, owner and history. */
export function DocDetails({ doc }: { doc: DocumentDetail }) {
  const patch = usePatchDocumentMeta(doc.id);
  const canEdit = doc.myPermission === 'edit' || doc.myPermission === 'manage';
  const [tag, setTag] = useState('');

  const addTag = () => {
    const t = tag.trim();
    if (!t || doc.tags.includes(t)) return setTag('');
    patch.mutate({ tags: [...doc.tags, t] });
    setTag('');
  };

  return (
    <dl className="divide-y divide-line">
      {doc.kind === 'page' && (
        <Row label="Type">
          <div className="mt-1 flex gap-1 rounded-pill bg-surface-2 p-0.5">
            {TYPES.map((t) => (
              <button
                key={t.key}
                disabled={!canEdit}
                onClick={() => patch.mutate({ pageType: t.key })}
                className={`flex-1 rounded-pill px-2 py-1 text-meta font-semibold ${doc.pageType === t.key ? 'bg-surface shadow-card' : 'text-ink-3'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </Row>
      )}

      {doc.kind === 'page' && (
        <Row label="Review">
          <div className="flex flex-wrap items-center gap-2">
            {doc.status === 'none' ? <span className="text-ink-3">Not tracked</span> : <StatusBadge status={doc.status} since={doc.verifiedAt} />}
            {canEdit && doc.status !== 'draft' && doc.status !== 'verified' && (
              <button onClick={() => patch.mutate({ status: 'draft' })} className="text-meta font-semibold text-accent">
                Mark as draft
              </button>
            )}
            {canEdit && doc.status !== 'none' && (
              <button onClick={() => patch.mutate({ status: 'none' })} className="text-meta font-semibold text-ink-3 hover:text-danger">
                Stop tracking
              </button>
            )}
          </div>
          {doc.verifiedByName && doc.verifiedAt && (
            <p className="mt-1 text-meta text-ink-3">
              Verified by {doc.verifiedByName} {relativeTime(doc.verifiedAt)}
            </p>
          )}
        </Row>
      )}

      {doc.kind === 'page' && (
        <Row label="Review every">
          <select
            disabled={!canEdit}
            value={doc.reviewIntervalDays}
            onChange={(e) => patch.mutate({ reviewIntervalDays: Number(e.target.value) })}
            className="mt-0.5 rounded-lg bg-surface-2 px-2 py-1 text-sm font-medium outline-none"
          >
            {[...new Set([...INTERVALS, doc.reviewIntervalDays])]
              .sort((a, b) => (a || Infinity) - (b || Infinity))
              .map((d) => (
                <option key={d} value={d}>
                  {d === 0 ? 'Never' : d % 365 === 0 ? `${d / 365} year` : d % 30 === 0 ? `${d / 30} months` : `${d} days`}
                </option>
              ))}
          </select>
        </Row>
      )}

      <Row label="Tags">
        <div className="mt-1 flex flex-wrap gap-1.5">
          {doc.tags.map((t) => (
            <span key={t} className="group inline-flex items-center">
              <TagChip>{t}</TagChip>
              {canEdit && (
                <button onClick={() => patch.mutate({ tags: doc.tags.filter((x) => x !== t) })} className="-ml-1 hidden rounded-full p-0.5 text-ink-3 hover:text-danger group-hover:inline" aria-label={`Remove ${t}`}>
                  <X className="size-3" />
                </button>
              )}
            </span>
          ))}
          {canEdit && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                addTag();
              }}
              className="inline-flex items-center"
            >
              <input
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                onBlur={addTag}
                maxLength={40}
                placeholder="ESXi 8"
                className="w-20 rounded-pill bg-surface-2 px-2 py-0.5 text-[0.6875rem] outline-none ring-accent focus:w-28 focus:ring-2"
                aria-label="Add tag"
              />
              {!tag && <Plus className="-ml-5 size-3 text-ink-3" />}
            </form>
          )}
        </div>
      </Row>

      <Row label="Owner">{doc.ownerName ?? '—'}</Row>
      <Row label="Last edited">
        {doc.updatedByName ? `${doc.updatedByName} · ` : ''}
        {relativeTime(doc.updatedAt)}
      </Row>
      <Row label="Created">
        {doc.createdByName ? `${doc.createdByName} · ` : ''}
        {new Date(doc.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
      </Row>
      <Row label="Your access">
        <span className="capitalize">{doc.myPermission}</span>
      </Row>
      {patch.error && <p className="py-2 text-sm text-danger">{patch.error.message}</p>}
    </dl>
  );
}
