'use client';

import { useQuery } from '@tanstack/react-query';
import type { AdminGroup } from '@trigon/shared';
import { Plus, Search, Trash2, X } from 'lucide-react';
import { useDeferredValue, useState, type FormEvent } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Badge, Button, Field, Result, TextInput } from '@/components/settings/ui';
import { api } from '@/lib/api';
import { useAdminGroups, useAdminMutation, useGroupMembers } from '@/lib/admin-queries';

const SOURCE = {
  local: { label: 'Local', tone: 'neutral' },
  entra: { label: 'Microsoft', tone: 'accent' },
  ldap: { label: 'LDAP', tone: 'warning' },
} as const;

function NewGroupSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const create = useAdminMutation((body: { name: string; description?: string }) => api('/admin/groups', { method: 'POST', json: body }));
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await create.mutateAsync({ name: String(f.get('name')), description: String(f.get('description') || '') || undefined });
    onOpenChange(false);
  };
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title="New group" description="Local groups are managed here. Microsoft and LDAP groups come from directory sync.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name">
          <TextInput name="name" required autoFocus />
        </Field>
        <Field label="Description">
          <TextInput name="description" />
        </Field>
        {create.error && <Result result={{ ok: false, message: create.error.message }} />}
        <Button type="submit" busy={create.isPending} className="w-full">
          Create group
        </Button>
      </form>
    </BottomSheet>
  );
}

function GroupSheet({ group, onClose }: { group: AdminGroup; onClose: () => void }) {
  const editable = group.source === 'local';
  const members = useGroupMembers(group.id);
  const keys = [['admin-groups'], ['admin-users']];
  const add = useAdminMutation((userId: string) => api(`/admin/groups/${group.id}/members`, { method: 'POST', json: { userId } }), keys);
  const remove = useAdminMutation((userId: string) => api(`/admin/groups/${group.id}/members/${userId}`, { method: 'DELETE' }), keys);
  const del = useAdminMutation(() => api(`/admin/groups/${group.id}`, { method: 'DELETE' }), keys);
  const [q, setQ] = useState('');
  const candidates = useQuery({
    queryKey: ['user-search', q],
    queryFn: () => api<{ id: string; email: string; displayName: string }[]>(`/users?q=${encodeURIComponent(q)}`),
    enabled: editable && q.trim().length > 1,
  });
  const memberIds = new Set(members.data?.map((m) => m.id));

  return (
    <BottomSheet open onOpenChange={(v) => !v && onClose()} title={group.name} description={group.description ?? undefined}>
      <div className="space-y-4">
        <div className="flex gap-1.5">
          <Badge tone={SOURCE[group.source].tone}>{SOURCE[group.source].label}</Badge>
          <Badge>{members.data?.length ?? group.members} members</Badge>
        </div>
        {!editable && <p className="text-sm text-ink-2">Membership is managed in {group.source === 'entra' ? 'Microsoft Entra ID' : 'your directory'} and updated on every sync.</p>}

        {editable && (
          <div>
            <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add people — search by name or email" />
            {candidates.data && q.trim().length > 1 && (
              <div className="mt-1 overflow-hidden rounded-xl border border-line">
                {candidates.data.filter((u) => !memberIds.has(u.id)).slice(0, 6).map((u) => (
                  <button
                    key={u.id}
                    onClick={() => add.mutate(u.id, { onSuccess: () => (setQ(''), members.refetch()) })}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-2"
                  >
                    <Plus className="size-4 text-accent" />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {u.displayName} <span className="text-ink-3">· {u.email}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <ul className="max-h-80 overflow-y-auto">
          {members.data?.map((m) => (
            <li key={m.id} className="flex items-center gap-3 py-2">
              <Avatar name={m.displayName} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{m.displayName}</span>
                <span className="block truncate text-meta text-ink-3">{m.email}</span>
              </span>
              {editable && (
                <button onClick={() => remove.mutate(m.id, { onSuccess: () => members.refetch() })} className="rounded-full p-1.5 text-ink-3 hover:bg-surface-2" aria-label={`Remove ${m.displayName}`}>
                  <X className="size-4" />
                </button>
              )}
            </li>
          ))}
          {members.data?.length === 0 && <li className="py-4 text-center text-sm text-ink-3">No members yet.</li>}
        </ul>

        {editable && (
          <Button variant="danger" busy={del.isPending} onClick={() => confirm(`Delete group “${group.name}”? Permissions granted to it are removed.`) && del.mutate(undefined, { onSuccess: onClose })}>
            <Trash2 className="size-4" /> Delete group
          </Button>
        )}
        {(add.error || remove.error || del.error) && <Result result={{ ok: false, message: (add.error ?? remove.error ?? del.error)!.message }} />}
      </div>
    </BottomSheet>
  );
}

export default function GroupsSettingsPage() {
  const [q, setQ] = useState('');
  const deferred = useDeferredValue(q);
  const { data, isPending } = useAdminGroups(deferred);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<AdminGroup | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <label className="flex flex-1 items-center gap-2 rounded-2xl bg-surface px-4 shadow-card ring-accent focus-within:ring-2">
          <Search className="size-4 text-ink-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search groups" className="min-w-0 flex-1 bg-transparent py-3 outline-none" />
        </label>
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" /> <span className="hidden sm:inline">New group</span>
        </Button>
      </div>

      <div className="overflow-hidden rounded-card bg-surface shadow-card">
        {isPending && <div className="h-40 animate-pulse" />}
        {data?.map((g, i) => (
          <button key={g.id} onClick={() => setSelected(g)} className={`press flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2 ${i ? 'border-t border-line' : ''}`}>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{g.name}</span>
              <span className="block truncate text-meta text-ink-3">{g.description || `${g.members} members`}</span>
            </span>
            <Badge>{g.members}</Badge>
            <Badge tone={SOURCE[g.source].tone}>{SOURCE[g.source].label}</Badge>
          </button>
        ))}
        {data?.length === 0 && <p className="p-8 text-center text-ink-3">No groups yet. Create one, or connect Microsoft Entra ID / LDAP to sync yours.</p>}
      </div>

      <NewGroupSheet open={creating} onOpenChange={setCreating} />
      {selected && <GroupSheet key={selected.id} group={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
