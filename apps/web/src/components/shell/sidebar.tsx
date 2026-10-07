'use client';

import type { SpaceSummary } from '@trigon/shared';
import { ChevronDown, Plus, Settings } from 'lucide-react';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { CreateSheet } from '@/components/ui/create-sheet';
import { SpaceIcon } from '@/components/ui/doc-icon';
import { Logo } from '@/components/ui/logo';
import { ThemeSwitch } from '@/components/ui/theme-switch';
import { useDocument, useSpaces } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { NAV_ITEMS } from './bottom-nav';
import { SpaceActions } from './node-actions';
import { SpaceTree, useSpaceRootDrop } from './space-tree';

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
    <div className={`mb-0.5 rounded-xl ${over ? 'bg-accent-soft ring-2 ring-accent' : ''}`} {...(canEdit ? handlers : {})}>
      <div className="group flex items-center">
        <button
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[0.9375rem] font-semibold hover:bg-surface-2"
          aria-expanded={open}
        >
          <SpaceIcon space={space} size="sm" />
          <span className="truncate">{space.name}</span>
          <ChevronDown className={`ml-auto size-3.5 shrink-0 text-ink-3 transition-transform ${open ? '' : '-rotate-90'}`} />
        </button>
        <div className="flex items-center opacity-0 transition-opacity group-hover:opacity-100 has-[[data-state=open]]:opacity-100">
          <SpaceActions space={space} />
          {canEdit && (
            <button onClick={onCreate} className="grid size-6 place-items-center rounded-md text-ink-3 hover:bg-surface-3 hover:text-ink" aria-label={`Add to ${space.name}`}>
              <Plus className="size-4" />
            </button>
          )}
        </div>
      </div>
      {open && (
        <div className="ml-2 mt-0.5 pb-1">
          <SpaceTree spaceId={space.id} activeId={activeId} canEdit={canEdit} />
        </div>
      )}
    </div>
  );
}

/** Desktop navigation pane: primary nav, then every space with its collapsible, drag-and-drop tree. */
export function Sidebar() {
  const pathname = usePathname();
  const params = useParams<{ spaceId?: string; docId?: string }>();
  const { user } = useSession();
  const { data: spaces } = useSpaces();
  const { data: doc } = useDocument(params.docId ?? '');
  const currentSpace = params.spaceId ?? (params.docId ? doc?.spaceId : undefined);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [createIn, setCreateIn] = useState<string | null>(null);

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
    <aside className="sticky top-0 flex h-dvh w-72 shrink-0 flex-col border-r border-line bg-surface">
      <Link href="/" className="flex h-16 shrink-0 items-center px-5" aria-label="Trigon home">
        <Logo size={34} />
      </Link>

      <nav className="px-3" aria-label="Primary">
        {NAV_ITEMS.map(({ href, label, icon: Icon, match }) => {
          const active = match(pathname) && !(href === '/spaces' && pathname.startsWith('/d/'));
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-xl px-3 py-2 text-[0.9375rem] font-medium ${active ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:bg-surface-2'}`}
            >
              <Icon className="size-[1.125rem]" />
              {label}
            </Link>
          );
        })}
        {user?.role === 'admin' && (
          <Link
            href="/settings"
            className={`flex items-center gap-3 rounded-xl px-3 py-2 text-[0.9375rem] font-medium ${pathname.startsWith('/settings') ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:bg-surface-2'}`}
          >
            <Settings className="size-[1.125rem]" />
            Settings
          </Link>
        )}
      </nav>

      <div className="mt-6 flex items-center justify-between px-5 text-[0.6875rem] font-semibold uppercase tracking-wider text-ink-2">
        Spaces
        <Link href="/spaces?new=1" className="rounded p-0.5 hover:bg-surface-2" aria-label="New space">
          <Plus className="size-3.5" />
        </Link>
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
        <div className="flex items-center gap-2 border-t border-line py-3 pl-4 pr-3">
          <Link href="/profile" className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-1 hover:bg-surface-2">
            <Avatar name={user.displayName} src={user.avatarUrl} size={32} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{user.displayName}</span>
              <span className="block truncate text-meta text-ink-3">{user.email}</span>
            </span>
          </Link>
          <ThemeSwitch />
        </div>
      )}
      {createIn && <CreateSheet open onOpenChange={(v) => !v && setCreateIn(null)} spaceId={createIn} />}
    </aside>
  );
}
