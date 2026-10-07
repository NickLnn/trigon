'use client';

import { ChevronDown, Plus } from 'lucide-react';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { CreateSheet } from '@/components/ui/create-sheet';
import { useDocument, useSpaces } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { NAV_ITEMS } from './bottom-nav';
import { SpaceTree } from './space-tree';

/** Desktop navigation pane: primary nav, then every space with its collapsible document tree. */
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

  return (
    <aside className="sticky top-0 flex h-dvh w-72 shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex items-center gap-2.5 px-5 pb-4 pt-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-192.png" alt="" className="size-8 rounded-[0.6rem]" />
        <span className="text-lg font-bold tracking-tight">Trigon</span>
      </div>

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
      </nav>

      <div className="mt-5 flex items-center justify-between px-6 text-[0.6875rem] font-semibold uppercase tracking-wider text-ink-3">
        Spaces
        <Link href="/spaces?new=1" className="rounded p-0.5 hover:bg-surface-2" aria-label="New space">
          <Plus className="size-3.5" />
        </Link>
      </div>
      <div className="no-scrollbar mt-1.5 min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {spaces?.map((s) => {
          const open = expanded.has(s.id);
          return (
            <div key={s.id} className="mb-0.5">
              <div className="group flex items-center">
                <button
                  onClick={() =>
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (open) next.delete(s.id);
                      else next.add(s.id);
                      return next;
                    })
                  }
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[0.9375rem] font-semibold hover:bg-surface-2"
                  aria-expanded={open}
                >
                  <span className="grid size-6 shrink-0 place-items-center rounded-md text-sm" style={{ background: s.color ?? 'var(--surface-2)' }}>
                    {s.icon ?? s.name[0]}
                  </span>
                  <span className="truncate">{s.name}</span>
                  <ChevronDown className={`ml-auto size-3.5 shrink-0 text-ink-3 transition-transform ${open ? '' : '-rotate-90'}`} />
                </button>
                {s.myPermission !== 'view' && s.myPermission !== 'comment' && (
                  <button onClick={() => setCreateIn(s.id)} className="rounded-md p-1 text-ink-3 opacity-0 hover:bg-surface-2 group-hover:opacity-100" aria-label={`Add to ${s.name}`}>
                    <Plus className="size-4" />
                  </button>
                )}
              </div>
              {open && (
                <div className="ml-2 mt-0.5">
                  <SpaceTree spaceId={s.id} activeId={params.docId} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {user && (
        <Link href="/profile" className="flex items-center gap-3 border-t border-line px-5 py-3 hover:bg-surface-2">
          <Avatar name={user.displayName} src={user.avatarUrl} size={32} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{user.displayName}</span>
            <span className="block truncate text-meta text-ink-3">{user.email}</span>
          </span>
        </Link>
      )}
      {createIn && <CreateSheet open onOpenChange={(v) => !v && setCreateIn(null)} spaceId={createIn} />}
    </aside>
  );
}
