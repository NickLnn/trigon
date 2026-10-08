'use client';

import { useQueryClient } from '@tanstack/react-query';
import type { DocumentNode } from '@trigon/shared';
import { ArrowLeft, ChevronRight, Plus, Upload } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useMemo, useState, type ReactNode } from 'react';
import { NodeActions, SpaceActions } from '@/components/shell/node-actions';
import { dropFiles } from '@/components/shell/space-tree';
import { CreateSheet } from '@/components/ui/create-sheet';
import { DocIcon, fileFlavor, relativeTime, SpaceIcon } from '@/components/ui/doc-icon';
import { PullToRefresh } from '@/components/ui/pull-to-refresh';
import { StatusBadge } from '@/components/ui/status-badge';
import { findPath, useSpace, useSpaceStats, useTree } from '@/lib/queries';

type Filter = 'all' | 'runbook' | 'kb' | 'files';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'runbook', label: 'Runbooks' },
  { key: 'kb', label: 'KB' },
  { key: 'files', label: 'Files' },
];

function flatten(nodes: DocumentNode[], out: DocumentNode[] = []) {
  for (const n of nodes) {
    out.push(n);
    if (n.children) flatten(n.children, out);
  }
  return out;
}

function subtitle(n: DocumentNode) {
  if (n.kind === 'folder') return `${n.children?.length ?? 0} items`;
  if (n.kind === 'file') return `${fileFlavor(n.mimeType, n.title).toUpperCase()} · ${relativeTime(n.updatedAt)}`;
  const type = n.pageType === 'runbook' ? 'Runbook' : n.pageType === 'kb' ? 'KB article' : 'Page';
  return `${type} · ${relativeTime(n.updatedAt)}`;
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-1.5 px-1 text-meta font-semibold text-ink-3">{title}</h2>
      <div className="overflow-hidden rounded-card bg-surface shadow-card">{children}</div>
    </section>
  );
}

/**
 * A space: navy header (logo, stats, filters) over a drill-down list. Tapping a folder pushes into
 * it and the breadcrumb pops back out; desktop users also have the full tree in the sidebar.
 */
export default function SpacePage({ params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const { data: space } = useSpace(spaceId);
  const { data: stats } = useSpaceStats(spaceId);
  const { data: tree, isPending } = useTree(spaceId);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [dropping, setDropping] = useState<'over' | 'busy' | null>(null);
  const canEdit = space?.myPermission === 'edit' || space?.myPermission === 'manage';

  const path = useMemo(() => (tree && folderId ? (findPath(tree, folderId) ?? []) : []), [tree, folderId]);
  const items: DocumentNode[] = useMemo(() => {
    if (filter === 'all') return folderId ? (path.at(-1)?.children ?? []) : (tree ?? []);
    // Filters search the whole space, flattened.
    const all = flatten(tree ?? []);
    if (filter === 'files') return all.filter((n) => n.kind === 'file');
    return all.filter((n) => n.kind === 'page' && n.pageType === filter);
  }, [filter, folderId, path, tree]);
  const folders = items.filter((n) => n.kind === 'folder');
  const docs = items.filter((n) => n.kind !== 'folder');

  const row = (n: DocumentNode, i: number) => {
    const body = (
      <>
        <DocIcon kind={n.kind} mimeType={n.mimeType} title={n.title} emoji={n.icon} pageType={n.pageType} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{n.title}</span>
          <span className="block truncate text-meta text-ink-3">{subtitle(n)}</span>
        </span>
        <StatusBadge status={n.status} compact />
      </>
    );
    const cls = 'press flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 text-left';
    return (
      <div key={n.id} className={`flex items-center pr-2 hover:bg-surface-2/60 ${i ? 'border-t border-line' : ''}`}>
        {n.kind === 'folder' ? (
          <button
            className={cls}
            onClick={() => {
              setFilter('all');
              setFolderId(n.id);
            }}
          >
            {body}
          </button>
        ) : (
          <Link href={`/d/${n.id}`} className={cls}>
            {body}
          </Link>
        )}
        <NodeActions node={n} canEdit={canEdit} triggerClassName="size-9 rounded-full" />
        {n.kind === 'folder' && <ChevronRight className="size-4 shrink-0 text-ink-3" />}
      </div>
    );
  };

  return (
    <PullToRefresh
      onRefresh={() =>
        Promise.all([qc.invalidateQueries({ queryKey: ['tree', spaceId] }), qc.invalidateQueries({ queryKey: ['space-stats', spaceId] })])
      }
    >
      {/* Navy header */}
      <header className="bg-navy px-4 pb-5 pt-[max(0.75rem,env(safe-area-inset-top))] text-white md:mx-8 md:mt-8 md:rounded-hero md:px-6 md:pt-5">
        <div className="mx-auto max-w-4xl">
          <div className="flex items-center justify-between">
            <button
              onClick={() => (folderId ? setFolderId(path.at(-2)?.id ?? null) : router.back())}
              className="press -ml-2 grid size-10 place-items-center rounded-full text-navy-ink-2 hover:bg-navy-2"
              aria-label="Back"
            >
              <ArrowLeft className="size-5" />
            </button>
            <div className="flex items-center gap-1 [&_button]:text-navy-ink-2 [&_button:hover]:bg-navy-2">
              {space && <SpaceActions space={space} triggerClassName="size-10 rounded-full" />}
              {canEdit && (
                <button onClick={() => setCreateOpen(true)} className="press grid size-10 place-items-center rounded-full" aria-label="Create">
                  <Plus className="size-5" />
                </button>
              )}
            </div>
          </div>
          <div className="mt-2 flex items-center gap-3">
            {space && (
              <span className="rounded-2xl bg-white p-1">
                <SpaceIcon space={space} size="lg" />
              </span>
            )}
            <div className="min-w-0">
              <h1 className="truncate text-title font-bold">{path.at(-1)?.title ?? space?.name ?? ''}</h1>
              <p className="truncate text-sm text-navy-ink-2">{folderId ? space?.name : (space?.description ?? 'Space')}</p>
            </div>
          </div>
          {!folderId && (
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              {[
                { label: 'Docs', value: stats?.docs, tone: '' },
                { label: 'Verified', value: stats?.verified, tone: 'text-navy-good' },
                { label: 'Need review', value: stats?.stale, tone: stats?.stale ? 'text-navy-warn' : '' },
              ].map((s) => (
                <div key={s.label} className="rounded-2xl bg-navy-2 px-2 py-2.5">
                  <div className={`text-xl font-bold tabular-nums ${s.tone}`}>{s.value ?? '–'}</div>
                  <div className="text-meta text-navy-ink-2">{s.label}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </header>

      <div
        className="relative mx-auto max-w-4xl space-y-4 px-4 pb-12 pt-4 md:px-8"
        onDragOver={(e) => {
          if (!canEdit || !Array.from(e.dataTransfer.types).includes('Files')) return;
          e.preventDefault();
          setDropping('over');
        }}
        onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDropping(null)}
        onDrop={async (e) => {
          if (!canEdit || !e.dataTransfer.files.length) return;
          e.preventDefault();
          setDropping('busy');
          try {
            await dropFiles(Array.from(e.dataTransfer.files), spaceId, folderId);
            await qc.invalidateQueries({ queryKey: ['tree', spaceId] });
          } finally {
            setDropping(null);
          }
        }}
      >
        {dropping && (
          <div className="pointer-events-none absolute inset-0 z-10 mx-4 grid place-items-center rounded-card border-2 border-dashed border-accent bg-accent-soft/80 md:mx-8">
            <span className="flex items-center gap-2 font-semibold text-accent">
              <Upload className="size-5" /> {dropping === 'busy' ? 'Uploading…' : 'Drop to upload — .md / .html become pages'}
            </span>
          </div>
        )}

        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`press shrink-0 rounded-pill px-4 py-1.5 text-sm font-semibold ${filter === f.key ? 'bg-navy text-white' : 'border border-line bg-surface text-ink-2'}`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {folderId && filter === 'all' && (
          <nav className="no-scrollbar flex items-center gap-1 overflow-x-auto whitespace-nowrap text-sm" aria-label="Breadcrumb">
            <button onClick={() => setFolderId(null)} className="rounded-pill bg-surface px-3 py-1.5 font-medium shadow-card">
              {space?.name}
            </button>
            {path.map((p) => (
              <span key={p.id} className="flex items-center gap-1">
                <ChevronRight className="size-3.5 text-ink-3" />
                <button onClick={() => setFolderId(p.id)} className="rounded-pill px-3 py-1.5 font-medium hover:bg-surface">
                  {p.title}
                </button>
              </span>
            ))}
          </nav>
        )}

        {isPending && <div className="h-40 animate-pulse rounded-card bg-surface" />}
        {!isPending && items.length === 0 && (
          <div className="rounded-card bg-surface p-10 text-center text-ink-3 shadow-card">
            <p>{filter === 'all' ? `This ${folderId ? 'folder' : 'space'} is empty.` : 'Nothing here yet.'}</p>
            {canEdit && (
              <button onClick={() => setCreateOpen(true)} className="mt-3 font-semibold text-accent">
                Create something
              </button>
            )}
          </div>
        )}
        {folders.length > 0 && <Group title="Folders">{folders.map(row)}</Group>}
        {docs.length > 0 && <Group title="Documents">{docs.map(row)}</Group>}
      </div>
      {canEdit && <CreateSheet open={createOpen} onOpenChange={setCreateOpen} spaceId={spaceId} parentId={folderId} />}
    </PullToRefresh>
  );
}
