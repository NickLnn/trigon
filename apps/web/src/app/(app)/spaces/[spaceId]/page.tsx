'use client';

import { useQueryClient } from '@tanstack/react-query';
import type { DocumentNode } from '@trigon/shared';
import { ChevronRight, Plus } from 'lucide-react';
import Link from 'next/link';
import { use, useMemo, useState } from 'react';
import { IconButton, PageHeader } from '@/components/shell/page-header';
import { CreateSheet } from '@/components/ui/create-sheet';
import { DocIcon, relativeTime } from '@/components/ui/doc-icon';
import { PullToRefresh } from '@/components/ui/pull-to-refresh';
import { findPath, useSpace, useTree } from '@/lib/queries';

/**
 * A space as a drill-down list (mobile-native navigation) — tapping a folder pushes into it,
 * the breadcrumb pops back out. Desktop users also have the full tree in the sidebar.
 */
export default function SpacePage({ params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = use(params);
  const qc = useQueryClient();
  const { data: space } = useSpace(spaceId);
  const { data: tree, isPending } = useTree(spaceId);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const canEdit = space?.myPermission === 'edit' || space?.myPermission === 'manage';

  const path = useMemo(() => (tree && folderId ? (findPath(tree, folderId) ?? []) : []), [tree, folderId]);
  const items: DocumentNode[] = folderId ? (path.at(-1)?.children ?? []) : (tree ?? []);

  return (
    <PullToRefresh onRefresh={() => qc.invalidateQueries({ queryKey: ['tree', spaceId] })}>
      <PageHeader
        back
        title={path.at(-1)?.title ?? space?.name ?? ''}
        subtitle={space?.description}
        actions={
          canEdit && (
            <IconButton label="Create" onClick={() => setCreateOpen(true)}>
              <Plus className="size-5" />
            </IconButton>
          )
        }
      />
      <div className="mx-auto max-w-3xl px-4 pb-10 md:px-10">
        {folderId && (
          <nav className="no-scrollbar mb-3 flex items-center gap-1 overflow-x-auto whitespace-nowrap text-sm" aria-label="Breadcrumb">
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

        <div className="overflow-hidden rounded-card bg-surface shadow-card">
          {isPending && <div className="h-32 animate-pulse" />}
          {!isPending && items.length === 0 && (
            <div className="p-10 text-center text-ink-3">
              <p>This {folderId ? 'folder' : 'space'} is empty.</p>
              {canEdit && (
                <button onClick={() => setCreateOpen(true)} className="mt-3 font-semibold text-accent">
                  Create a page
                </button>
              )}
            </div>
          )}
          {items.map((n, i) => {
            const row = (
              <>
                <DocIcon kind={n.kind} mimeType={n.mimeType} title={n.title} emoji={n.icon} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{n.title}</span>
                  <span className="block text-meta text-ink-3">
                    {n.kind === 'folder' ? `${n.children?.length ?? 0} items` : relativeTime(n.updatedAt)}
                  </span>
                </span>
                <ChevronRight className="size-4 text-ink-3" />
              </>
            );
            const cls = `press flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2 ${i ? 'border-t border-line' : ''}`;
            return n.kind === 'folder' ? (
              <button key={n.id} className={cls} onClick={() => setFolderId(n.id)}>
                {row}
              </button>
            ) : (
              <Link key={n.id} href={`/d/${n.id}`} className={cls}>
                {row}
              </Link>
            );
          })}
        </div>
      </div>
      {canEdit && <CreateSheet open={createOpen} onOpenChange={setCreateOpen} spaceId={spaceId} parentId={folderId} />}
    </PullToRefresh>
  );
}
