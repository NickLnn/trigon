'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ChevronRight, LayoutGrid, NotebookPen, Search, Upload } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { PageHeader } from '@/components/shell/page-header';
import { Avatar } from '@/components/ui/avatar';
import { CreateSheet } from '@/components/ui/create-sheet';
import { DocIcon, relativeTime, SpaceIcon } from '@/components/ui/doc-icon';
import { PullToRefresh } from '@/components/ui/pull-to-refresh';
import { useRecent, useSpaces } from '@/lib/queries';
import { useSession } from '@/lib/session';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function QuickAction({ icon, label, onClick, href }: { icon: ReactNode; label: string; onClick?: () => void; href?: string }) {
  const inner = (
    <>
      <span className="grid size-14 place-items-center rounded-full bg-surface shadow-card">{icon}</span>
      <span className="text-meta font-medium text-ink-2">{label}</span>
    </>
  );
  const cls = 'press flex flex-col items-center gap-2';
  return href ? (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  ) : (
    <button onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

export default function HomePage() {
  const { user } = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: recent, isPending } = useRecent();
  const { data: spaces } = useSpaces();
  const [createOpen, setCreateOpen] = useState(false);
  const writable = spaces?.find((s) => s.myPermission === 'edit' || s.myPermission === 'manage');

  return (
    <PullToRefresh onRefresh={() => qc.invalidateQueries()}>
      <PageHeader
        title={`${greeting()}${user ? `, ${user.displayName.split(' ')[0]}` : ''}`}
        actions={
          user && (
            <Link href="/profile" className="md:hidden" aria-label="Profile">
              <Avatar name={user.displayName} src={user.avatarUrl} size={36} />
            </Link>
          )
        }
      />

      <div className="mx-auto max-w-5xl space-y-6 px-4 pb-10 md:px-10">
        <section className="grid grid-cols-4 gap-2 rounded-card bg-surface-2/60 p-4 md:max-w-xl">
          <QuickAction icon={<NotebookPen className="size-6 text-accent" />} label="New page" onClick={() => (writable ? setCreateOpen(true) : router.push('/spaces?new=1'))} />
          <QuickAction icon={<Upload className="size-6 text-accent" />} label="Upload" onClick={() => (writable ? setCreateOpen(true) : router.push('/spaces?new=1'))} />
          <QuickAction icon={<Search className="size-6 text-accent" />} label="Search" href="/search" />
          <QuickAction icon={<LayoutGrid className="size-6 text-accent" />} label="Spaces" href="/spaces" />
        </section>

        {!!spaces?.length && (
          <section>
            <div className="mb-3 flex items-center justify-between px-1">
              <h2 className="text-lg font-bold">Spaces</h2>
              <Link href="/spaces" className="text-sm font-semibold text-accent">
                See all
              </Link>
            </div>
            <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 md:mx-0 md:grid md:grid-cols-3 md:px-0">
              {spaces.slice(0, 8).map((s) => (
                <Link
                  key={s.id}
                  href={`/spaces/${s.id}`}
                  className="press w-40 shrink-0 snap-start rounded-card bg-surface p-4 shadow-card md:w-auto"
                >
                  <SpaceIcon space={s} size="md" />
                  <p className="mt-6 truncate font-semibold">{s.name}</p>
                  <p className="truncate text-meta capitalize text-ink-3">{s.myPermission}</p>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section>
          <h2 className="mb-3 px-1 text-lg font-bold">Recent</h2>
          <div className="overflow-hidden rounded-card bg-surface shadow-card">
            {isPending &&
              [0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3 p-4">
                  <div className="size-10 animate-pulse rounded-xl bg-surface-2" />
                  <div className="h-4 w-1/2 animate-pulse rounded bg-surface-2" />
                </div>
              ))}
            {recent?.length === 0 && (
              <p className="p-6 text-center text-ink-3">Nothing here yet. Create a space and your first page.</p>
            )}
            {recent?.map((d, i) => (
              <Link
                key={d.id}
                href={`/d/${d.id}`}
                className={`press flex items-center gap-3 px-4 py-3 hover:bg-surface-2 ${i ? 'border-t border-line' : ''}`}
              >
                <DocIcon kind={d.kind} mimeType={d.mimeType} title={d.title} emoji={d.icon} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{d.title}</span>
                  <span className="block truncate text-meta text-ink-3">
                    {d.spaceName} · {relativeTime(d.updatedAt)}
                  </span>
                </span>
                <ChevronRight className="size-4 text-ink-3" />
              </Link>
            ))}
          </div>
        </section>
      </div>
      {writable && <CreateSheet open={createOpen} onOpenChange={setCreateOpen} spaceId={writable.id} />}
    </PullToRefresh>
  );
}
