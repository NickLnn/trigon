'use client';

import type { DirectoryPick } from '@trigon/shared';
import { Check, Globe, Loader2, Search, UserRound, Users, X } from 'lucide-react';
import { useDeferredValue, useEffect, useState } from 'react';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { useEntraDirectorySearch, useSaveEntraScope, useSyncNow } from '@/lib/admin-queries';
import { Button, Result } from './ui';

/**
 * "Who gets access to Trigon": pick Microsoft Entra groups (members, including nested groups, are
 * synced) and/or individual users — or allow the whole tenant. Saving starts a sync.
 */
export function EntraScopeSheet({
  open,
  onOpenChange,
  initial,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: { syncScope: 'all' | 'selected'; syncGroups: DirectoryPick[]; syncUsers: DirectoryPick[] };
}) {
  const [scope, setScope] = useState(initial.syncScope);
  const [groups, setGroups] = useState<DirectoryPick[]>(initial.syncGroups);
  const [users, setUsers] = useState<DirectoryPick[]>(initial.syncUsers);
  const [tab, setTab] = useState<'group' | 'user'>('group');
  const [q, setQ] = useState('');
  const term = useDeferredValue(q.trim());
  const search = useEntraDirectorySearch(tab, term, open && scope === 'selected');
  const save = useSaveEntraScope();
  const sync = useSyncNow('entra');

  useEffect(() => {
    if (!open) return;
    setScope(initial.syncScope);
    setGroups(initial.syncGroups);
    setUsers(initial.syncUsers);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const picked = tab === 'group' ? groups : users;
  const setPicked = tab === 'group' ? setGroups : setUsers;
  const toggle = (p: DirectoryPick) => setPicked((list) => (list.some((x) => x.id === p.id) ? list.filter((x) => x.id !== p.id) : [...list, p]));
  const nothingChosen = scope === 'selected' && !groups.length && !users.length;

  const apply = async () => {
    await save.mutateAsync({ syncScope: scope, syncGroups: groups, syncUsers: users });
    await sync.mutateAsync().catch(() => undefined); // a sync may already be running
    onOpenChange(false);
  };

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title="Who gets access" description="Choose which Microsoft groups and people are brought into Trigon.">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {[
            { key: 'selected' as const, icon: Users, title: 'Selected groups and people', hint: 'Recommended' },
            { key: 'all' as const, icon: Globe, title: 'Everyone in the tenant', hint: 'All users and groups' },
          ].map((o) => (
            <button
              key={o.key}
              onClick={() => setScope(o.key)}
              className={`press rounded-2xl border p-3 text-left ${scope === o.key ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface-2'}`}
            >
              <o.icon className={`size-5 ${scope === o.key ? 'text-accent' : 'text-ink-3'}`} />
              <span className="mt-2 block text-sm font-semibold">{o.title}</span>
              <span className="block text-meta text-ink-3">{o.hint}</span>
            </button>
          ))}
        </div>

        {scope === 'selected' && (
          <>
            <div className="flex rounded-pill bg-surface-2 p-1 text-sm font-semibold">
              {(['group', 'user'] as const).map((t) => (
                <button key={t} onClick={() => setTab(t)} className={`flex flex-1 items-center justify-center gap-1.5 rounded-pill py-1.5 ${tab === t ? 'bg-surface shadow-card' : 'text-ink-3'}`}>
                  {t === 'group' ? <Users className="size-4" /> : <UserRound className="size-4" />}
                  {t === 'group' ? `Groups (${groups.length})` : `People (${users.length})`}
                </button>
              ))}
            </div>

            <label className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 ring-accent focus-within:ring-2">
              {search.isFetching ? <Loader2 className="size-4 animate-spin text-ink-3" /> : <Search className="size-4 text-ink-3" />}
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tab === 'group' ? 'Search groups' : 'Search people by name or email'} className="min-w-0 flex-1 bg-transparent py-2.5 outline-none" />
            </label>

            {picked.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {picked.map((p) => (
                  <span key={p.id} className="inline-flex items-center gap-1 rounded-pill bg-accent-soft py-1 pl-3 pr-1 text-sm font-medium text-accent">
                    {p.name}
                    <button onClick={() => toggle(p)} className="rounded-full p-0.5 hover:bg-accent/15" aria-label={`Remove ${p.name}`}>
                      <X className="size-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="max-h-72 overflow-y-auto rounded-xl border border-line">
              {search.error && <p className="p-3 text-sm text-danger">{search.error.message}</p>}
              {search.data?.length === 0 && <p className="p-4 text-center text-sm text-ink-3">No matches.</p>}
              {search.data?.map((p, i) => {
                const on = picked.some((x) => x.id === p.id);
                return (
                  <button key={p.id} onClick={() => toggle(p)} className={`flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-2 ${i ? 'border-t border-line' : ''}`}>
                    <span className={`grid size-5 shrink-0 place-items-center rounded-md border-2 ${on ? 'border-accent bg-accent text-white' : 'border-line'}`}>{on && <Check className="size-3.5" />}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{p.name}</span>
                      {p.detail && <span className="block truncate text-meta text-ink-3">{p.detail}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="text-meta text-ink-3">
              Group members are included automatically, including members of nested groups. Only the people you choose here can sign in with Microsoft.
            </p>
          </>
        )}

        {scope === 'all' && (
          <p className="rounded-xl bg-warning/12 px-3.5 py-2.5 text-sm">Every user and group in the tenant will be imported, and everyone can sign in with Microsoft.</p>
        )}
        {(save.error || sync.error) && <Result result={{ ok: false, message: (save.error ?? sync.error)!.message }} />}

        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)} className="flex-1">
            Cancel
          </Button>
          <Button onClick={apply} busy={save.isPending} disabled={nothingChosen} className="flex-1">
            Save and sync
          </Button>
        </div>
        {nothingChosen && <p className="-mt-2 text-center text-meta text-ink-3">Pick at least one group or person.</p>}
      </div>
    </BottomSheet>
  );
}
