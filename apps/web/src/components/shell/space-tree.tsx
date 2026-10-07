'use client';

import type { DocumentNode } from '@trigon/shared';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { DocIcon } from '@/components/ui/doc-icon';
import { findPath, useTree } from '@/lib/queries';

function TreeNode({ node, depth, activeId, openIds, toggle }: { node: DocumentNode; depth: number; activeId?: string; openIds: Set<string>; toggle: (id: string) => void }) {
  const hasChildren = !!node.children?.length;
  const open = openIds.has(node.id);
  const active = node.id === activeId;
  const isFolder = node.kind === 'folder';

  const row = (
    <>
      <span
        role={hasChildren ? 'button' : undefined}
        aria-label={hasChildren ? (open ? 'Collapse' : 'Expand') : undefined}
        onClick={(e) => {
          if (!hasChildren) return;
          e.preventDefault();
          e.stopPropagation();
          toggle(node.id);
        }}
        className={`grid size-5 shrink-0 place-items-center rounded text-ink-3 hover:bg-surface-3 ${hasChildren ? '' : 'invisible'}`}
      >
        <ChevronRight className={`size-3.5 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
      </span>
      <DocIcon kind={node.kind} mimeType={node.mimeType} title={node.title} emoji={node.icon} size="sm" />
      <span className="truncate">{node.title}</span>
    </>
  );

  const cls = `group flex w-full items-center gap-1.5 rounded-lg py-1 pr-2 text-[0.875rem] ${active ? 'bg-accent-soft font-medium text-accent' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'}`;

  return (
    <li>
      {isFolder ? (
        <button className={cls} style={{ paddingLeft: depth * 14 + 4 }} onClick={() => toggle(node.id)} aria-expanded={open}>
          {row}
        </button>
      ) : (
        <Link href={`/d/${node.id}`} className={cls} style={{ paddingLeft: depth * 14 + 4 }} aria-current={active ? 'page' : undefined}>
          {row}
        </Link>
      )}
      {hasChildren && open && (
        <ul>
          {node.children!.map((c) => (
            <TreeNode key={c.id} node={c} depth={depth + 1} activeId={activeId} openIds={openIds} toggle={toggle} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Desktop sidebar tree for one space; auto-expands to reveal the open document. */
export function SpaceTree({ spaceId, activeId }: { spaceId: string; activeId?: string }) {
  const { data, isPending } = useTree(spaceId);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!data || !activeId) return;
    const path = findPath(data, activeId);
    if (path) setOpenIds((s) => new Set([...s, ...path.slice(0, -1).map((n) => n.id)]));
  }, [data, activeId]);

  const toggle = (id: string) =>
    setOpenIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (isPending) {
    return (
      <div className="space-y-2 px-2 py-1">
        {[70, 55, 80].map((w) => (
          <div key={w} className="h-5 animate-pulse rounded bg-surface-2" style={{ width: `${w}%` }} />
        ))}
      </div>
    );
  }
  if (!data?.length) return <p className="px-3 py-1 text-meta text-ink-3">Empty space</p>;
  return (
    <ul className="space-y-px">
      {data.map((n) => (
        <TreeNode key={n.id} node={n} depth={0} activeId={activeId} openIds={openIds} toggle={toggle} />
      ))}
    </ul>
  );
}
