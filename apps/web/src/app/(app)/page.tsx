'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ChevronRight, CircleAlert, FileDown, ListChecks, NotebookPen, Search, Upload } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { CreateSheet, type CreateStart } from '@/components/ui/create-sheet';
import { DocIcon, relativeTime, SpaceIcon } from '@/components/ui/doc-icon';
import { PullToRefresh } from '@/components/ui/pull-to-refresh';
import { StatusBadge } from '@/components/ui/status-badge';
import { useHealth, useRecent, useSpaces } from '@/lib/queries';
import { useSession } from '@/lib/session';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function QuickAction({ icon, label, onClick, dark }: { icon: ReactNode; label: string; onClick: () => void; dark?: boolean }) {
  return (
    <button onClick={onClick} className="press flex flex-col items-center gap-1.5 text-meta font-medium md:flex-row md:gap-2">
      <span
        className={`grid size-12 place-items-center rounded-full md:size-9 ${
          dark ? 'bg-navy-3 text-white' : 'border border-line bg-surface text-accent shadow-card'
        }`}
      >
        {icon}
      </span>
      <span className={dark ? 'text-navy-ink-2' : 'text-ink-2'}>{label}</span>
    </button>
  );
}

/** The navy "balance" card: knowledge-base health. */
function HealthCard({ children }: { children?: ReactNode }) {
  const { data } = useHealth();
  const score = data?.score ?? 0;
  return (
    <section className="rounded-hero bg-navy p-5 text-white md:p-6">
      <div className="flex items-center justify-between text-sm text-navy-ink-2">
        <span>Knowledge base health</span>
        <span>{data ? `${data.total.toLocaleString()} pages` : ''}</span>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-[2.5rem] font-bold leading-none tracking-tight tabular-nums">{data ? `${score}%` : '–'}</span>
        <span className="text-sm font-medium text-navy-good">verified</span>
      </div>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-navy-3">
        <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${score}%` }} />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-navy-ink-2">
        <span>{data?.verified ?? 0} verified</span>
        <span className={data?.stale ? 'text-navy-warn' : ''}>{data?.stale ?? 0} need review</span>
        <span>{data?.drafts ?? 0} drafts</span>
      </div>
      {children}
    </section>
  );
}

function NeedsReview() {
  const { data } = useHealth();
  return (
    <section className="rounded-card bg-surface p-4 shadow-card">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-bold">Needs review</h2>
        <Link href="/review" className="text-sm font-semibold text-accent">
          See all
        </Link>
      </div>
      {!data?.needsReview.length ? (
        <p className="py-3 text-sm text-ink-3">Everything is verified and up to date.</p>
      ) : (
        <ul>
          {data.needsReview.slice(0, 5).map((d, i) => (
            <li key={d.id}>
              <Link href={`/d/${d.id}`} className={`flex items-center gap-2.5 py-2 text-sm hover:text-accent ${i ? 'border-t border-line' : ''}`}>
                <CircleAlert className={`size-4 shrink-0 ${d.status === 'stale' ? 'text-danger' : 'text-warning'}`} />
                <span className="min-w-0 flex-1 truncate font-medium">{d.title}</span>
                <span className="shrink-0 text-meta text-ink-3">{relativeTime(d.since)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function HomePage() {
  const { user } = useSession();
  const qc = useQueryClient();
  const { data: recent, isPending } = useRecent();
  const { data: spaces } = useSpaces();
  const [create, setCreate] = useState<CreateStart | null>(null);
  const writable = spaces?.find((s) => s.myPermission === 'edit' || s.myPermission === 'manage');

  const actions = (dark: boolean) =>
    writable ? (
      <>
        <QuickAction dark={dark} icon={<NotebookPen className="size-5 md:size-4" />} label="Page" onClick={() => setCreate('page')} />
        <QuickAction dark={dark} icon={<ListChecks className="size-5 md:size-4" />} label="Runbook" onClick={() => setCreate('runbook')} />
        <QuickAction dark={dark} icon={<Upload className="size-5 md:size-4" />} label="Upload" onClick={() => setCreate('upload')} />
        <QuickAction dark={dark} icon={<FileDown className="size-5 md:size-4" />} label="Import" onClick={() => setCreate('import')} />
      </>
    ) : null;

  return (
    <PullToRefresh onRefresh={() => qc.invalidateQueries()}>
      {/* Phone top bar: avatar + search pill */}
      <div className="flex items-center gap-3 px-4 pb-3 pt-[max(0.875rem,env(safe-area-inset-top))] md:hidden">
        {user && (
          <Link href="/profile" aria-label="Profile">
            <Avatar name={user.displayName} src={user.avatarUrl} size={36} />
          </Link>
        )}
        <Link href="/search" className="flex flex-1 items-center gap-2 rounded-pill bg-surface-3/70 px-4 py-2.5 text-sm text-ink-3">
          <Search className="size-4" /> Search runbooks, KBs…
        </Link>
      </div>

      <div className="mx-auto max-w-6xl px-4 pb-10 md:px-8 md:pt-8">
        <div className="mb-5 hidden items-center justify-between md:flex">
          <h1 className="text-title font-bold">
            {greeting()}
            {user ? `, ${user.displayName.split(' ')[0]}` : ''}
          </h1>
          <Link href="/search" className="flex w-72 items-center gap-2 rounded-pill border border-line bg-surface px-4 py-2 text-sm text-ink-3 hover:border-accent">
            <Search className="size-4" /> Search…
            <kbd className="ml-auto rounded bg-surface-2 px-1.5 text-[0.6875rem]">Ctrl K</kbd>
          </Link>
        </div>

        <div className="grid gap-5 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="space-y-5">
            <HealthCard>
              {writable && <div className="mt-5 hidden flex-wrap gap-5 border-t border-navy-3 pt-4 md:flex">{actions(true)}</div>}
            </HealthCard>

            {writable && <div className="grid grid-cols-4 md:hidden">{actions(false)}</div>}

            <section>
              <h2 className="mb-2 px-1 font-bold">Recent activity</h2>
              <div className="overflow-hidden rounded-card bg-surface shadow-card">
                {isPending &&
                  [0, 1, 2].map((i) => (
                    <div key={i} className="flex items-center gap-3 p-4">
                      <div className="size-10 animate-pulse rounded-xl bg-surface-2" />
                      <div className="h-4 w-1/2 animate-pulse rounded bg-surface-2" />
                    </div>
                  ))}
                {recent?.length === 0 && <p className="p-6 text-center text-ink-3">Nothing yet — create a space and your first page.</p>}
                {recent?.map((d, i) => (
                  <Link key={d.id} href={`/d/${d.id}`} className={`press flex items-center gap-3 px-4 py-3 hover:bg-surface-2/60 ${i ? 'border-t border-line' : ''}`}>
                    {d.spaceIcon?.startsWith('img:') && !d.icon ? (
                      <SpaceIcon space={{ name: d.spaceName, icon: d.spaceIcon, color: d.spaceColor }} size="md" />
                    ) : (
                      <DocIcon kind={d.kind} mimeType={d.mimeType} title={d.title} emoji={d.icon} pageType={d.pageType} />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{d.title}</span>
                      <span className="block truncate text-meta text-ink-3">
                        {d.updatedByName ? `${d.updatedByName.split(' ')[0]} · ` : ''}
                        {relativeTime(d.updatedAt)} · {d.spaceName}
                      </span>
                    </span>
                    <StatusBadge status={d.status} compact />
                    <ChevronRight className="hidden size-4 text-ink-3 md:block" />
                  </Link>
                ))}
              </div>
            </section>
          </div>

          <div className="space-y-5">
            <NeedsReview />
            {!!spaces?.length && (
              <section>
                <div className="mb-2 flex items-center justify-between px-1">
                  <h2 className="font-bold">Spaces</h2>
                  <Link href="/spaces" className="text-sm font-semibold text-accent">
                    All
                  </Link>
                </div>
                <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 md:mx-0 md:grid md:grid-cols-2 md:px-0">
                  {spaces.slice(0, 6).map((s) => (
                    <Link key={s.id} href={`/spaces/${s.id}`} className="press w-36 shrink-0 snap-start rounded-card bg-surface p-4 shadow-card md:w-auto">
                      <SpaceIcon space={s} size="md" />
                      <p className="mt-4 truncate font-semibold">{s.name}</p>
                      <p className="truncate text-meta capitalize text-ink-3">{s.myPermission}</p>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
      {writable && create && <CreateSheet open onOpenChange={(v) => !v && setCreate(null)} spaceId={writable.id} start={create} chooseSpace />}
    </PullToRefresh>
  );
}
