'use client';

import { useQuery } from '@tanstack/react-query';
import type { HealthStats, SpaceSummary } from '@trigon/shared';
import { CircleCheck, Home, LayoutGrid, Plus, Search, Settings } from 'lucide-react';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { CreateSheet } from '@/components/ui/create-sheet';
import { SpaceIcon } from '@/components/ui/doc-icon';
import { Logo } from '@/components/ui/logo';
import { ThemeSwitch } from '@/components/ui/theme-switch';
import { api } from '@/lib/api';
import { useDocument, useSpaces } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { SpaceActions } from './node-actions';
import { SpaceTree, useSpaceRootDrop } from './space-tree';

const navItem = (active: boolean) =>
  `flex items-center gap-3 rounded-xl px-3 py-2 text-[0.875rem] font-medium transition-colors ${
    active ? 'bg-navy-3 text-white' : 'text-navy-ink-2 hover:bg-navy-2 hover:text-white'
  }`;

function SpaceSection({
  space,
  open,
  onToggle,
  onCreate,
  activeId,
}: {
  space: SpaceSummary;
  open: boolean;
  onToggle: () => void;
  onCreate: () => void;
  activeId?: string;
}) {
  const { over, handlers } = useSpaceRootDrop(space.id);
  const canEdit = space.myPermission === 'edit' || space.myPermission === 'manage';
  return (
    <div className={`mb-0.5 rounded-xl ${over ? 'bg-navy-3 ring-2 ring-accent' : ''}`} {...(canEdit ? handlers : {})}>
      <div className="group flex items-center rounded-xl pr-1 hover:bg-navy-2">
        <button onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-1.5 text-left text-[0.875rem] font-medium text-white" aria-expanded={open}>
          <SpaceIcon space={space} size="sm" />
          <span className="truncate">{space.name}</span>
        </button>
        <div className="flex items-center opacity-0 transition-opacity group-hover:opacity-100 has-[[data-state=open]]:opacity-100 [&_button]:text-navy-ink-3 [&_button:hover]:bg-navy-3 [&_button:hover]:text-white">
          <SpaceActions space={space} />
          {canEdit && (
            <button onClick={onCreate} className="grid size-6 place-items-center rounded-md" aria-label={`Add to ${space.name}`}>
              <Plus className="size-4" />
            </button>
          )}
        </div>
      </div>
      {open && (
        <div className="ml-3 border-l border-navy-3 pb-1 pl-1.5">
          <SpaceTree spaceId={space.id} activeId={activeId} canEdit={canEdit} />
        </div>
      )}
    </div>
  );
}

/** Desktop navigation: navy brand pane with primary nav, spaces and their drag-and-drop trees. */
export function Sidebar() {
  const pathname = usePathname();
  const params = useParams<{ spaceId?: string; docId?: string }>();
  const { user } = useSession();
  const { data: spaces } = useSpaces();
  const { data: doc } = useDocument(params.docId ?? '');
  const { data: health } = useQuery({ queryKey: ['health'], queryFn: () => api<HealthStats>('/documents/health'), staleTime: 60_000 });
  const currentSpace = params.spaceId ?? (params.docId ? doc?.spaceId : undefined);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [createIn, setCreateIn] = useState<string | null>(null);
  const reviewCount = (health?.stale ?? 0) + (health?.drafts ?? 0);

  useEffect(() => {
    if (currentSpace) setExpanded((s) => new Set([...s, currentSpace]));
  }, [currentSpace]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <aside className="sticky top-0 flex h-dvh w-[17rem] shrink-0 flex-col bg-navy text-navy-ink-2">
      <Link href="/" className="flex h-16 shrink-0 items-center px-5" aria-label="Trigon home">
        <Logo size={30} onDark />
      </Link>

      <nav className="space-y-0.5 px-3" aria-label="Primary">
        <Link href="/" className={navItem(pathname === '/')}>
          <Home className="size-[1.125rem]" /> Home
        </Link>
        <Link href="/search" className={navItem(pathname.startsWith('/search'))}>
          <Search className="size-[1.125rem]" /> Search
          <kbd className="ml-auto rounded-md bg-navy-2 px-1.5 py-0.5 font-sans text-[0.6875rem] text-navy-ink-3">Ctrl K</kbd>
        </Link>
        <Link href="/review" className={navItem(pathname.startsWith('/review'))}>
          <CircleCheck className="size-[1.125rem]" /> Review
          {reviewCount > 0 && <span className="ml-auto rounded-full bg-[#3a2a10] px-2 text-[0.6875rem] font-semibold text-navy-warn">{reviewCount}</span>}
        </Link>
        <Link href="/spaces" className={navItem(pathname === '/spaces')}>
          <LayoutGrid className="size-[1.125rem]" /> All spaces
        </Link>
        {user?.role === 'admin' && (
          <Link href="/settings" className={navItem(pathname.startsWith('/settings'))}>
            <Settings className="size-[1.125rem]" /> Settings
          </Link>
        )}
      </nav>

      <div className="mt-6 flex items-center justify-between px-5 text-[0.6875rem] font-semibold uppercase tracking-wider text-navy-ink-3">
        Spaces
        {user?.role !== 'viewer' && (
          <Link href="/spaces?new=1" className="grid size-5 place-items-center rounded hover:bg-navy-2 hover:text-white" aria-label="New space">
            <Plus className="size-3.5" />
          </Link>
        )}
      </div>
      <div className="no-scrollbar mt-1.5 min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {spaces?.map((s) => (
          <SpaceSection
            key={s.id}
            space={s}
            open={expanded.has(s.id)}
            onToggle={() => toggle(s.id)}
            onCreate={() => setCreateIn(s.id)}
            activeId={params.docId}
          />
        ))}
      </div>

      {user && (
        <div className="flex items-center gap-2 border-t border-navy-3 px-3 py-3">
          <Link href="/profile" className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl p-1.5 hover:bg-navy-2">
            <Avatar name={user.displayName} src={user.avatarUrl} size={30} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-white">{user.displayName}</span>
              <span className="block truncate text-meta capitalize text-navy-ink-3">{user.role}</span>
            </span>
          </Link>
          <ThemeSwitch className="bg-navy-2 [&_[aria-checked=false]]:text-navy-ink-3 [&_[aria-checked=true]]:bg-navy-3 [&_[aria-checked=true]]:text-white" />
        </div>
      )}
      {createIn && <CreateSheet open onOpenChange={(v) => !v && setCreateIn(null)} spaceId={createIn} />}
    </aside>
  );
}
