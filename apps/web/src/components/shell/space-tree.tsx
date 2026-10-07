'use client';

import { useQueryClient } from '@tanstack/react-query';
import type { DocumentNode } from '@trigon/shared';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, type DragEvent } from 'react';
import { DocIcon } from '@/components/ui/doc-icon';
import { api } from '@/lib/api';
import { importFiles } from '@/lib/importer';
import { findPath, useMoveDocument, useTree } from '@/lib/queries';

type Zone = 'before' | 'inside' | 'after';

/** What is being dragged (dataTransfer can't be read during dragover, so keep it here). */
let dragging: { id: string; spaceId: string; blocked: Set<string> } | null = null;

const IMPORTABLE = /\.(md|markdown|mdx|html?)$/i;

/** Upload dropped OS files: Markdown/HTML become pages, everything else becomes a file node. */
export async function dropFiles(files: File[], spaceId: string, parentId: string | null) {
  const imports = files.filter((f) => IMPORTABLE.test(f.name));
  const uploads = files.filter((f) => !IMPORTABLE.test(f.name));
  if (imports.length) await importFiles(imports, { spaceId, parentId });
  for (const file of uploads) {
    const form = new FormData();
    form.append('spaceId', spaceId);
    if (parentId) form.append('parentId', parentId);
    form.append('file', file);
    await api('/files', { method: 'POST', body: form });
  }
}

const isFileDrag = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

function collectIds(node: DocumentNode, into = new Set<string>()) {
  into.add(node.id);
  node.children?.forEach((c) => collectIds(c, into));
  return into;
}

interface NodeProps {
  node: DocumentNode;
  siblings: DocumentNode[];
  depth: number;
  activeId?: string;
  openIds: Set<string>;
  toggle: (id: string) => void;
  hover: { id: string; zone: Zone } | null;
  setHover: (h: { id: string; zone: Zone } | null) => void;
  onDrop: (target: DocumentNode, siblings: DocumentNode[], zone: Zone, e: DragEvent) => void;
}

function TreeNode({ node, siblings, depth, activeId, openIds, toggle, hover, setHover, onDrop }: NodeProps) {
  const hasChildren = !!node.children?.length;
  const open = openIds.has(node.id);
  const active = node.id === activeId;
  const isFolder = node.kind === 'folder';
  const zone = hover?.id === node.id ? hover.zone : null;

  const zoneFor = (e: DragEvent): Zone => {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - rect.top) / rect.height;
    if (node.kind === 'file') return y < 0.5 ? 'before' : 'after';
    if (y < 0.28) return 'before';
    if (y > 0.72) return 'after';
    return 'inside';
  };

  const dnd = {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      dragging = { id: node.id, spaceId: node.spaceId, blocked: collectIds(node) };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', node.title);
    },
    onDragEnd: () => {
      dragging = null;
      setHover(null);
    },
    onDragOver: (e: DragEvent) => {
      const files = isFileDrag(e);
      if (!files && (!dragging || dragging.spaceId !== node.spaceId || dragging.blocked.has(node.id))) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = files ? 'copy' : 'move';
      const z = zoneFor(e);
      if (hover?.id !== node.id || hover.zone !== z) setHover({ id: node.id, zone: z });
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setHover(null);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onDrop(node, siblings, zoneFor(e), e);
      setHover(null);
    },
  };

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

  const cls = `group relative flex w-full items-center gap-1.5 rounded-lg py-1 pr-2 text-[0.875rem] ${
    zone === 'inside' ? 'bg-accent-soft ring-2 ring-accent' : active ? 'bg-accent-soft font-medium text-accent' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'
  }`;
  const indicator = zone === 'before' || zone === 'after' ? (
    <span
      className="pointer-events-none absolute right-1 h-0.5 rounded-full bg-accent"
      style={{ left: depth * 14 + 8, [zone === 'before' ? 'top' : 'bottom']: -1 }}
    />
  ) : null;

  return (
    <li>
      {isFolder ? (
        <button {...dnd} className={cls} style={{ paddingLeft: depth * 14 + 4 }} onClick={() => toggle(node.id)} aria-expanded={open}>
          {row}
          {indicator}
        </button>
      ) : (
        <Link {...dnd} href={`/d/${node.id}`} className={cls} style={{ paddingLeft: depth * 14 + 4 }} aria-current={active ? 'page' : undefined}>
          {row}
          {indicator}
        </Link>
      )}
      {hasChildren && open && (
        <ul>
          {node.children!.map((c) => (
            <TreeNode
              key={c.id}
              node={c}
              siblings={node.children!}
              depth={depth + 1}
              activeId={activeId}
              openIds={openIds}
              toggle={toggle}
              hover={hover}
              setHover={setHover}
              onDrop={onDrop}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Position between neighbours so only the moved row is written. */
function positionFor(target: DocumentNode, siblings: DocumentNode[], zone: 'before' | 'after', movingId: string) {
  const list = siblings.filter((s) => s.id !== movingId);
  const i = list.findIndex((s) => s.id === target.id);
  if (zone === 'before') {
    const prev = list[i - 1];
    return prev ? (prev.position + target.position) / 2 : target.position - 1;
  }
  const next = list[i + 1];
  return next ? (target.position + next.position) / 2 : target.position + 1;
}

/** Desktop sidebar tree for one space, with drag & drop; auto-expands to reveal the open document. */
export function SpaceTree({ spaceId, activeId }: { spaceId: string; activeId?: string }) {
  const qc = useQueryClient();
  const { data, isPending } = useTree(spaceId);
  const move = useMoveDocument();
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<{ id: string; zone: Zone } | null>(null);

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

  const onDrop = async (target: DocumentNode, siblings: DocumentNode[], zone: Zone, e: DragEvent) => {
    const parentId = zone === 'inside' ? target.id : target.parentId;
    if (isFileDrag(e)) {
      await dropFiles(Array.from(e.dataTransfer.files), spaceId, parentId);
      if (zone === 'inside') setOpenIds((s) => new Set([...s, target.id]));
      qc.invalidateQueries({ queryKey: ['tree', spaceId] });
      qc.invalidateQueries({ queryKey: ['recent'] });
      return;
    }
    if (!dragging || dragging.blocked.has(target.id)) return;
    const id = dragging.id;
    const position =
      zone === 'inside'
        ? Math.max(0, ...(target.children ?? []).filter((c) => c.id !== id).map((c) => c.position)) + 1
        : positionFor(target, siblings, zone, id);
    if (zone === 'inside') setOpenIds((s) => new Set([...s, target.id]));
    move.mutate({ id, spaceId, parentId, position });
  };

  if (isPending) {
    return (
      <div className="space-y-2 px-2 py-1">
        {[70, 55, 80].map((w) => (
          <div key={w} className="h-5 animate-pulse rounded bg-surface-2" style={{ width: `${w}%` }} />
        ))}
      </div>
    );
  }
  if (!data?.length) return <p className="px-3 py-1 text-meta text-ink-3">Empty — drop files here</p>;
  return (
    <ul className="space-y-px">
      {data.map((n) => (
        <TreeNode
          key={n.id}
          node={n}
          siblings={data}
          depth={0}
          activeId={activeId}
          openIds={openIds}
          toggle={toggle}
          hover={hover}
          setHover={setHover}
          onDrop={onDrop}
        />
      ))}
    </ul>
  );
}

/** Drop target for a whole space (its header / empty area): moves items to the root or uploads files there. */
export function useSpaceRootDrop(spaceId: string) {
  const qc = useQueryClient();
  const move = useMoveDocument();
  const [over, setOver] = useState(false);
  return {
    over,
    handlers: {
      onDragOver: (e: DragEvent) => {
        if (!isFileDrag(e) && (!dragging || dragging.spaceId !== spaceId)) return;
        e.preventDefault();
        setOver(true);
      },
      onDragLeave: (e: DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
      },
      onDrop: async (e: DragEvent) => {
        e.preventDefault();
        setOver(false);
        if (isFileDrag(e)) {
          await dropFiles(Array.from(e.dataTransfer.files), spaceId, null);
        } else if (dragging && dragging.spaceId === spaceId) {
          const roots = qc.getQueryData<DocumentNode[]>(['tree', spaceId]) ?? [];
          move.mutate({ id: dragging.id, spaceId, parentId: null, position: Math.max(0, ...roots.map((r) => r.position)) + 1 });
          return;
        }
        qc.invalidateQueries({ queryKey: ['tree', spaceId] });
        qc.invalidateQueries({ queryKey: ['recent'] });
      },
    },
  };
}
