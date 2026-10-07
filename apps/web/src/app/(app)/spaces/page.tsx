'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { IconButton, PageHeader } from '@/components/shell/page-header';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { SpaceIcon } from '@/components/ui/doc-icon';
import { PullToRefresh } from '@/components/ui/pull-to-refresh';
import { useCreateSpace, useSpaces } from '@/lib/queries';

const COLORS = ['#E6EFFD', '#FDE8E8', '#E3F7EE', '#FFF3DC', '#F0E8FD', '#E0F6FA', '#EEF0F3'];
const ICONS = ['📘', '🛠️', '🚀', '📊', '🧭', '🔐', '💡', '🏢'];

function NewSpaceSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const create = useCreateSpace();
  const router = useRouter();
  const [icon, setIcon] = useState(ICONS[0]);
  const [color, setColor] = useState(COLORS[0]);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const space = await create.mutateAsync({
      name: String(form.get('name')),
      description: String(form.get('description') || '') || undefined,
      icon,
      color,
    });
    onOpenChange(false);
    router.push(`/spaces/${space.id}`);
  };

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title="New space">
      <form onSubmit={submit} className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="grid size-14 shrink-0 place-items-center rounded-2xl text-2xl" style={{ background: color }}>
            {icon}
          </span>
          <input name="name" required maxLength={80} placeholder="Space name" className="w-full rounded-2xl bg-surface-2 px-4 py-3.5 outline-none ring-accent focus:ring-2" />
        </div>
        <textarea name="description" maxLength={500} rows={2} placeholder="What is this space for? (optional)" className="w-full resize-none rounded-2xl bg-surface-2 px-4 py-3 outline-none ring-accent focus:ring-2" />
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          {ICONS.map((i) => (
            <button type="button" key={i} onClick={() => setIcon(i)} className={`grid size-11 shrink-0 place-items-center rounded-xl text-xl ${icon === i ? 'bg-accent-soft ring-2 ring-accent' : 'bg-surface-2'}`}>
              {i}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {COLORS.map((c) => (
            <button type="button" key={c} onClick={() => setColor(c)} aria-label={`Colour ${c}`} className={`size-8 rounded-full ${color === c ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface' : ''}`} style={{ background: c }} />
          ))}
        </div>
        {create.error && <p className="text-sm text-danger">{create.error.message}</p>}
        <button disabled={create.isPending} className="press w-full rounded-pill bg-accent py-3.5 font-semibold text-accent-ink disabled:opacity-60">
          Create space
        </button>
      </form>
    </BottomSheet>
  );
}

function SpacesList() {
  const qc = useQueryClient();
  const params = useSearchParams();
  const { data: spaces, isPending } = useSpaces();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (params.get('new')) setOpen(true);
  }, [params]);

  return (
    <PullToRefresh onRefresh={() => qc.invalidateQueries({ queryKey: ['spaces'] })}>
      <PageHeader
        title="Workspaces"
        subtitle={spaces ? `${spaces.length} space${spaces.length === 1 ? '' : 's'}` : undefined}
        actions={
          <IconButton label="New space" onClick={() => setOpen(true)}>
            <Plus className="size-5" />
          </IconButton>
        }
      />
      <div className="mx-auto max-w-5xl px-4 pb-10 md:px-10">
        {isPending && <div className="h-40 animate-pulse rounded-card bg-surface" />}
        {spaces?.length === 0 && (
          <button onClick={() => setOpen(true)} className="press w-full rounded-card border-2 border-dashed border-line p-10 text-center text-ink-2">
            <Plus className="mx-auto mb-2 size-6" />
            Create your first space
          </button>
        )}
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {spaces?.map((s) => (
            <Link key={s.id} href={`/spaces/${s.id}`} className="press flex items-center gap-4 rounded-card bg-surface p-4 shadow-card">
              <SpaceIcon space={s} size="lg" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{s.name}</span>
                <span className="block truncate text-meta text-ink-3">{s.description || `You can ${s.myPermission}`}</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-ink-3" />
            </Link>
          ))}
        </div>
      </div>
      <NewSpaceSheet open={open} onOpenChange={setOpen} />
    </PullToRefresh>
  );
}

export default function SpacesPage() {
  return (
    <Suspense>
      <SpacesList />
    </Suspense>
  );
}
