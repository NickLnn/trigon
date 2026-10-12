import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { ActivityEvent, ActivityPage } from '@trigon/shared';
import { api } from './api';

export interface ActivityFilters {
  q: string;
  category: string;
  action: string;
  actor: string;
  space: string;
  target: string;
  /** Preset ('24h', '7d', '30d', '90d', 'all') or 'custom' with from/to (yyyy-mm-dd). */
  range: string;
  from: string;
  to: string;
}

export const RANGES = [
  { value: '24h', label: 'Last 24 hours', ms: 86_400_000 },
  { value: '7d', label: 'Last 7 days', ms: 7 * 86_400_000 },
  { value: '30d', label: 'Last 30 days', ms: 30 * 86_400_000 },
  { value: '90d', label: 'Last 90 days', ms: 90 * 86_400_000 },
  { value: 'all', label: 'All time', ms: 0 },
  { value: 'custom', label: 'Custom range…', ms: 0 },
] as const;

/** Filters → API query string (dates become ISO instants in the viewer's time zone). */
export function activityQuery(f: ActivityFilters, extra: Record<string, string> = {}) {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.category) p.set('category', f.category);
  if (f.action) p.set('action', f.action);
  if (f.actor) p.set('actor', f.actor);
  if (f.space) p.set('space', f.space);
  if (f.target) p.set('target', f.target);
  const preset = RANGES.find((r) => r.value === f.range);
  if (preset && preset.ms) p.set('from', new Date(Date.now() - preset.ms).toISOString());
  if (f.range === 'custom') {
    if (f.from) p.set('from', new Date(`${f.from}T00:00:00`).toISOString());
    if (f.to) p.set('to', new Date(`${f.to}T23:59:59.999`).toISOString());
  }
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  return p.toString();
}

export function useActivity(f: ActivityFilters) {
  // Preset ranges are relative to "now"; keying on the filters (not the computed instant) keeps the cache stable.
  return useInfiniteQuery({
    queryKey: ['activity', f],
    queryFn: ({ pageParam }) => api<ActivityPage>(`/activity?${activityQuery(f, pageParam ? { cursor: pageParam } : {})}`),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export const useActivityActors = () =>
  useQuery({ queryKey: ['activity-actors'], queryFn: () => api<{ id: string; name: string | null; email: string | null }[]>('/activity/actors'), staleTime: 60_000 });

const FIELD_LABELS: Record<string, string> = {
  pageType: 'Type',
  status: 'Status',
  tags: 'Tags',
  reviewIntervalDays: 'Review interval',
  owner: 'Owner',
  icon: 'Icon',
  name: 'Name',
  description: 'Description',
  color: 'Colour',
  sortMode: 'Sort',
  role: 'Role',
  active: 'Active',
  displayName: 'Name',
};

const show = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (v === 'alpha') return 'A–Z';
  return String(v);
};

export const fieldLabel = (f: string) => FIELD_LABELS[f] ?? f;

/** Changed fields as readable "Field: before → after" lines (icons only say they changed). */
export function changeLines(changes: unknown): string[] {
  if (!changes || typeof changes !== 'object') return [];
  return Object.entries(changes as Record<string, { from: unknown; to: unknown }>).map(([f, c]) =>
    f === 'icon' ? 'Icon changed' : `${fieldLabel(f)}: ${show(c.from)} → ${show(c.to)}`,
  );
}

/** Line diff stored with "Edited page/file" entries (see apps/api/src/activity/text-diff.ts). */
export interface EditDiff {
  added: number;
  removed: number;
  lines: { t: ' ' | '+' | '-' | '…'; s: string }[];
  truncated: boolean;
}

export const editDiff = (details: Record<string, unknown>): EditDiff | null => {
  const d = details.diff as EditDiff | undefined;
  return d && Array.isArray(d.lines) ? d : null;
};

const size = (b: number) => (b < 1024 ? `${b} B` : b < 1024 ** 2 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1024 ** 2).toFixed(1)} MB`);

/** One-line summary of what happened, for the list. */
export function summary(e: ActivityEvent): string {
  const d = e.details as Record<string, unknown>;
  switch (e.action) {
    case 'item.created':
    case 'item.imported':
      return `in ${show(d.location)}`;
    case 'file.uploaded':
      return typeof d.sizeBytes === 'number' ? size(d.sizeBytes) : '';
    case 'page.edited':
    case 'file.edited': {
      const diff = editDiff(d);
      const saves = Number(d.saves) > 1 ? `${d.saves} saves` : '1 save';
      return diff ? `+${diff.added} −${diff.removed} lines · ${saves}` : saves;
    }
    case 'item.renamed':
    case 'item.moved':
      return `${show(d.from)} → ${show(d.to)}`;
    case 'item.updated':
    case 'space.updated':
    case 'user.updated':
      return changeLines(d.changes).join(' · ');
    case 'item.deleted':
    case 'space.deleted':
      return Number(d.itemsDeleted) > 1 ? `${d.itemsDeleted} items` : d.location ? `from ${show(d.location)}` : '';
    case 'share.added':
    case 'share.removed':
      return `${show(d.sharedWith)} · ${show(d.level)}`;
    case 'share.changed':
      return `${show(d.sharedWith)} · ${show(d.previousLevel)} → ${show(d.level)}`;
    case 'user.signed_in':
      return show(d.method);
    case 'user.sign_in_failed':
      return `${show(d.method)} · ${show(d.reason)}`;
    case 'user.created':
      return d.selfRegistered ? 'Self-registered' : [d.email, d.role].filter(Boolean).join(' · ');
    case 'group.member_added':
    case 'group.member_removed':
      return show(d.member);
    case 'version.restored':
      return `to the version from ${show(d.version)}`;
    case 'item.restored':
      return Number(d.itemsRestored) > 1 ? `${d.itemsRestored} items` : d.location ? show(d.location) : '';
    case 'item.purged':
      return Number(d.itemsDeleted) > 1 ? `${d.itemsDeleted} items, for good` : 'for good';
    case 'review.requested':
      return show(d.reviewer) + (d.message ? ` · “${d.message}”` : '');
    case 'review.approved':
    case 'review.changes_requested':
      return d.note ? `“${d.note}”` : '';
    case 'review.cancelled':
      return show(d.reviewer);
    case 'settings.updated':
      return Array.isArray(d.fields) ? d.fields.join(', ') : '';
    default:
      return '';
  }
}
