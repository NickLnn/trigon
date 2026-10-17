'use client';

import {
  ACTIVITY_ACTIONS,
  ACTIVITY_CATEGORIES,
  ACTIVITY_CATEGORY_LABELS,
  activityLabel,
  type ActivityCategory,
  type ActivityEvent,
} from '@trigon/shared';
import { Download, ExternalLink, FileText, Folder, KeyRound, LayoutGrid, Search, Settings2, Share2, ShieldAlert, UserRound, Users, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useDeferredValue, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Badge, Button } from '@/components/settings/ui';
import { PageHeader } from '@/components/shell/page-header';
import { Avatar } from '@/components/ui/avatar';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { relativeTime } from '@/components/ui/doc-icon';
import { DiffView } from '@/components/ui/diff-view';
import { activityQuery, changeLines, editDiff, RANGES, summary, useActivity, useActivityActors, type ActivityFilters } from '@/lib/activity';
import { useSpaces } from '@/lib/queries';
import { useSession } from '@/lib/session';

const FILTER_KEYS = ['q', 'category', 'action', 'actor', 'space', 'target', 'range', 'from', 'to'] as const;
const DEFAULT_RANGE = '30d';

const CATEGORY_TONE: Record<ActivityCategory, 'neutral' | 'accent' | 'success' | 'danger' | 'warning'> = {
  content: 'neutral',
  sharing: 'accent',
  spaces: 'success',
  access: 'neutral',
  admin: 'warning',
};

function TargetIcon({ e }: { e: ActivityEvent }) {
  const cls = 'size-4';
  if (e.action === 'user.sign_in_failed') return <ShieldAlert className={`${cls} text-danger`} />;
  if (e.category === 'sharing') return <Share2 className={cls} />;
  switch (e.targetType) {
    case 'folder':
      return <Folder className={cls} />;
    case 'page':
    case 'file':
      return <FileText className={cls} />;
    case 'space':
      return <LayoutGrid className={cls} />;
    case 'group':
      return <Users className={cls} />;
    case 'settings':
      return <Settings2 className={cls} />;
    default:
      return e.category === 'access' ? <KeyRound className={cls} /> : <UserRound className={cls} />;
  }
}

const fullTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

const selectCls = 'h-10 min-w-0 rounded-xl bg-surface px-3 text-sm shadow-card outline-none ring-accent focus:ring-2';

/** Where an event's target can be opened (deleted items and settings can't). */
function targetHref(e: ActivityEvent) {
  if (!e.targetId || e.action === 'item.deleted' || e.action === 'space.deleted') return null;
  if (e.targetType === 'space') return `/spaces/${e.targetId}`;
  if (e.targetType === 'page' || e.targetType === 'file' || e.targetType === 'folder') return `/d/${e.targetId}`;
  return null;
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 border-t border-line py-2.5 first:border-t-0">
      <dt className="w-28 shrink-0 text-meta font-semibold text-ink-3">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-sm">{children}</dd>
    </div>
  );
}

function EventSheet({ e, onClose, onFilter }: { e: ActivityEvent; onClose: () => void; onFilter: (patch: Partial<ActivityFilters>) => void }) {
  const d = e.details as Record<string, unknown>;
  const href = targetHref(e);
  const changes = changeLines(d.changes);
  const diff = editDiff(d);
  return (
    <BottomSheet open onOpenChange={(v) => !v && onClose()} title={activityLabel(e.action, e.targetType)} description={fullTime(e.at)}>
      <dl className="rounded-2xl bg-surface-2/60 px-4 py-1">
        <DetailRow label="User">
          {e.actorName ?? 'Unknown'}
          {e.actorEmail && <span className="block text-meta text-ink-3">{e.actorEmail}</span>}
        </DetailRow>
        <DetailRow label="Activity">
          {activityLabel(e.action, e.targetType)} <Badge tone={CATEGORY_TONE[e.category]}>{ACTIVITY_CATEGORY_LABELS[e.category]}</Badge>
        </DetailRow>
        {e.targetName && (
          <DetailRow label="Item">
            {e.targetName} <span className="text-meta text-ink-3">({e.targetType})</span>
          </DetailRow>
        )}
        {e.spaceName && <DetailRow label="Space">{e.spaceName}</DetailRow>}
        {typeof d.sharedWith === 'string' && <DetailRow label="Shared with">{d.sharedWith}</DetailRow>}
        {typeof d.level === 'string' && (
          <DetailRow label="Access">{typeof d.previousLevel === 'string' ? `${d.previousLevel} → ${d.level}` : d.level}</DetailRow>
        )}
        {changes.length > 0 && (
          <DetailRow label="Changes">
            {changes.map((c) => (
              <span key={c} className="block">
                {c}
              </span>
            ))}
          </DetailRow>
        )}
        {(e.action === 'item.renamed' || e.action === 'item.moved') && (
          <DetailRow label={e.action === 'item.renamed' ? 'Renamed' : 'Moved'}>
            {String(d.from)} → {String(d.to)}
          </DetailRow>
        )}
        {(e.action === 'page.edited' || e.action === 'file.edited') && (
          <DetailRow label="Editing">
            {String(d.saves ?? 1)} save{Number(d.saves) === 1 ? '' : 's'}
            {typeof d.until === 'string' && ` · until ${fullTime(d.until)}`}
          </DetailRow>
        )}
        {typeof d.location === 'string' && <DetailRow label="Location">{d.location}</DetailRow>}
        {typeof d.itemsDeleted === 'number' && <DetailRow label="Items deleted">{d.itemsDeleted}</DetailRow>}
        {typeof d.method === 'string' && <DetailRow label="Method">{d.method}</DetailRow>}
        {typeof d.reason === 'string' && <DetailRow label="Reason">{d.reason}</DetailRow>}
        {typeof d.member === 'string' && <DetailRow label="Member">{d.member}</DetailRow>}
        {typeof d.reviewer === 'string' && <DetailRow label="Reviewer">{d.reviewer}</DetailRow>}
        {typeof d.version === 'string' && <DetailRow label="Version">{d.version}</DetailRow>}
        {typeof d.itemsRestored === 'number' && <DetailRow label="Items restored">{d.itemsRestored}</DetailRow>}
        {typeof d.message === 'string' && <DetailRow label="Message">{d.message}</DetailRow>}
        {typeof d.note === 'string' && <DetailRow label="Note">{d.note}</DetailRow>}
        {typeof d.excerpt === 'string' && <DetailRow label={d.reply ? 'Reply' : 'Comment'}>{d.excerpt}</DetailRow>}
        {typeof d.quote === 'string' && <DetailRow label="On the text">“{d.quote}”</DetailRow>}
        {Array.isArray(d.fields) && <DetailRow label="Fields saved">{d.fields.join(', ')}</DetailRow>}
        <DetailRow label="IP address">{e.ip ?? '—'}</DetailRow>
        {e.userAgent && (
          <DetailRow label="Device">
            <span className="text-meta text-ink-2">{e.userAgent}</span>
          </DetailRow>
        )}
      </dl>
      {diff && <DiffView diff={diff} />}
      <div className="mt-4 flex flex-wrap gap-2">
        {e.actorId && (
          <Button variant="secondary" onClick={() => onFilter({ actor: e.actorId! })}>
            <UserRound className="size-4" /> Everything by {e.actorName?.split(' ')[0] ?? 'this user'}
          </Button>
        )}
        {e.targetId && (
          <Button variant="secondary" onClick={() => onFilter({ target: e.targetId! })}>
            <TargetIcon e={e} /> History of this {e.targetType ?? 'item'}
          </Button>
        )}
        {href && (
          <Link href={href} className="press inline-flex items-center gap-2 rounded-pill bg-surface-2 px-4 py-2.5 text-sm font-semibold hover:bg-surface-3">
            <ExternalLink className="size-4" /> Open
          </Link>
        )}
      </div>
    </BottomSheet>
  );
}

function Explorer() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const filters = useMemo(() => {
    const f = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? ''])) as unknown as ActivityFilters;
    f.range ||= DEFAULT_RANGE;
    return f;
  }, [params]);

  const setFilters = (patch: Partial<ActivityFilters>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (next.get('range') === DEFAULT_RANGE) next.delete('range');
    router.replace(`${pathname}${next.size ? `?${next}` : ''}`, { scroll: false });
  };

  // Typing updates the URL after a short pause, not on every key.
  const [q, setQ] = useState(filters.q);
  const deferredQ = useDeferredValue(q);
  useEffect(() => {
    const t = setTimeout(() => deferredQ !== filters.q && setFilters({ q: deferredQ }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferredQ]);

  const { data, isPending, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useActivity(filters);
  const { data: actors } = useActivityActors();
  const { data: spaces } = useSpaces();
  const [selected, setSelected] = useState<ActivityEvent | null>(null);
  const events = data?.pages.flatMap((p) => p.items) ?? [];
  const targetName = events.find((e) => e.targetId === filters.target)?.targetName;
  const active = FILTER_KEYS.some((k) => k !== 'range' && filters[k]) || filters.range !== DEFAULT_RANGE;
  const actionsInCategory = (Object.keys(ACTIVITY_ACTIONS) as (keyof typeof ACTIVITY_ACTIONS)[]).filter(
    (a) => !filters.category || ACTIVITY_ACTIONS[a].category === filters.category,
  );

  return (
    <>
      <PageHeader
        title="Activity"
        subtitle="Who created, edited, moved, deleted or shared what, and when."
        actions={
          <a
            href={`/api/activity/export?${activityQuery(filters)}`}
            download
            className="press inline-flex items-center gap-2 rounded-pill bg-surface px-4 py-2 text-sm font-semibold shadow-card hover:bg-surface-2"
          >
            <Download className="size-4" /> <span className="hidden sm:inline">Export CSV</span>
          </a>
        }
      />
      <div className="mx-auto max-w-6xl space-y-3 px-4 pb-12 md:px-10">
        <label className="flex items-center gap-2 rounded-2xl bg-surface px-4 shadow-card ring-accent focus-within:ring-2">
          <Search className="size-4 text-ink-3" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search people, pages, spaces, shared with, IP address…"
            className="min-w-0 flex-1 bg-transparent py-3 outline-none"
          />
          {q && (
            <button onClick={() => setQ('')} className="grid size-6 place-items-center rounded-full text-ink-3 hover:bg-surface-2" aria-label="Clear search">
              <X className="size-4" />
            </button>
          )}
        </label>

        <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0" role="tablist" aria-label="Activity type">
          {(['', ...ACTIVITY_CATEGORIES] as const).map((c) => (
            <button
              key={c || 'all'}
              role="tab"
              aria-selected={filters.category === c}
              onClick={() => setFilters({ category: c, action: '' })}
              className={`press shrink-0 rounded-pill px-3.5 py-1.5 text-sm font-semibold ${
                filters.category === c ? 'bg-accent text-accent-ink' : 'bg-surface text-ink-2 shadow-card hover:bg-surface-2'
              }`}
            >
              {c ? ACTIVITY_CATEGORY_LABELS[c] : 'All activity'}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <select aria-label="Activity" value={filters.action} onChange={(e) => setFilters({ action: e.target.value })} className={selectCls}>
            <option value="">Any activity</option>
            {(filters.category ? [filters.category as ActivityCategory] : ACTIVITY_CATEGORIES).map((c) => (
              <optgroup key={c} label={ACTIVITY_CATEGORY_LABELS[c]}>
                {actionsInCategory
                  .filter((a) => ACTIVITY_ACTIONS[a].category === c)
                  .map((a) => (
                    <option key={a} value={a}>
                      {activityLabel(a, 'item')}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
          <select aria-label="User" value={filters.actor} onChange={(e) => setFilters({ actor: e.target.value })} className={selectCls}>
            <option value="">Any user</option>
            {actors?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name ?? a.email ?? 'Unknown'}
              </option>
            ))}
          </select>
          <select aria-label="Space" value={filters.space} onChange={(e) => setFilters({ space: e.target.value })} className={selectCls}>
            <option value="">Any space</option>
            {spaces?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select aria-label="Date range" value={filters.range} onChange={(e) => setFilters({ range: e.target.value })} className={selectCls}>
            {RANGES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>

        {filters.range === 'custom' && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-ink-3">From</span>
            <input type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilters({ from: e.target.value })} className={selectCls} />
            <span className="text-ink-3">to</span>
            <input type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => setFilters({ to: e.target.value })} className={selectCls} />
          </div>
        )}

        {(filters.target || active) && (
          <div className="flex flex-wrap items-center gap-2">
            {filters.target && (
              <span className="inline-flex items-center gap-1.5 rounded-pill bg-accent-soft py-1 pl-3 pr-1 text-sm font-semibold text-accent">
                History of {targetName ?? 'one item'}
                <button onClick={() => setFilters({ target: '' })} className="grid size-5 place-items-center rounded-full hover:bg-accent/15" aria-label="Remove item filter">
                  <X className="size-3.5" />
                </button>
              </span>
            )}
            {active && (
              <button
                onClick={() => {
                  setQ('');
                  router.replace(pathname, { scroll: false });
                }}
                className="text-sm font-semibold text-accent hover:underline"
              >
                Clear all filters
              </button>
            )}
          </div>
        )}

        <div className="overflow-hidden rounded-card bg-surface shadow-card">
          <div className="hidden grid-cols-[9rem_12rem_14rem_1fr_9rem] gap-3 border-b border-line px-4 py-2.5 text-meta font-semibold uppercase tracking-wide text-ink-3 lg:grid">
            <span>Time</span>
            <span>User</span>
            <span>Activity</span>
            <span>Item and details</span>
            <span>Space</span>
          </div>
          {isPending && <div className="h-48 animate-pulse" />}
          {isError && <p className="p-8 text-center text-danger">{(error as Error).message}</p>}
          {data && events.length === 0 && (
            <p className="p-10 text-center text-ink-3">{active ? 'No activity matches these filters.' : 'No activity recorded yet.'}</p>
          )}
          {events.map((e, i) => (
            <button
              key={e.id}
              onClick={() => setSelected(e)}
              className={`press grid w-full grid-cols-[auto_1fr] items-center gap-x-3 gap-y-0.5 px-4 py-3 text-left hover:bg-surface-2/60 lg:grid-cols-[9rem_12rem_14rem_1fr_9rem] lg:gap-3 ${
                i ? 'border-t border-line' : ''
              }`}
            >
              <span className="hidden text-sm text-ink-2 lg:block" title={fullTime(e.at)}>
                {relativeTime(e.at)}
              </span>
              <span className="row-span-2 flex min-w-0 items-center gap-2 lg:row-span-1">
                <Avatar name={e.actorName ?? '?'} size={28} />
                <span className="hidden min-w-0 truncate text-sm font-semibold lg:block">{e.actorName ?? 'Unknown'}</span>
              </span>
              <span className="flex min-w-0 items-center gap-2 text-sm">
                <span className={`shrink-0 ${e.action === 'user.sign_in_failed' ? '' : 'text-ink-3'}`}>
                  <TargetIcon e={e} />
                </span>
                <span className="truncate font-semibold lg:font-medium">
                  <span className="lg:hidden">{e.actorName ?? 'Unknown'} · </span>
                  {activityLabel(e.action, e.targetType)}
                </span>
              </span>
              <span className="min-w-0 truncate text-meta text-ink-3 lg:text-sm lg:text-ink-2">
                <span className="lg:hidden">{relativeTime(e.at)} · </span>
                {e.targetName && <span className="font-medium text-ink lg:text-ink">{e.targetName}</span>}
                {e.targetName && summary(e) ? ' · ' : ''}
                {summary(e)}
                {e.spaceName && <span className="lg:hidden"> · {e.spaceName}</span>}
              </span>
              <span className="hidden truncate text-sm text-ink-2 lg:block">{e.spaceName ?? '—'}</span>
            </button>
          ))}
        </div>

        {hasNextPage && (
          <div className="flex justify-center">
            <Button variant="secondary" busy={isFetchingNextPage} onClick={() => fetchNextPage()}>
              Load more
            </Button>
          </div>
        )}
        <p className="px-1 text-meta text-ink-3">
          Typing in a page is grouped into one “Edited page” entry per person per 30 minutes. Opening and reading pages isn&apos;t recorded.
        </p>
      </div>
      {selected && (
        <EventSheet
          e={selected}
          onClose={() => setSelected(null)}
          onFilter={(patch) => {
            setSelected(null);
            setFilters(patch);
          }}
        />
      )}
    </>
  );
}

/** Activity explorer (audit log), in the spirit of Microsoft Purview. Administrators only. */
export default function ActivityPage() {
  const { user } = useSession();
  if (user && user.role !== 'admin') return <p className="p-10 text-center text-ink-2">Activity is only available to administrators.</p>;
  return (
    <Suspense>
      <Explorer />
    </Suspense>
  );
}
