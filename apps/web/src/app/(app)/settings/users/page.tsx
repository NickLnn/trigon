'use client';

import type { AdminUser, SystemRole } from '@trigon/shared';
import { KeyRound, Search, UserPlus } from 'lucide-react';
import { useDeferredValue, useState, type FormEvent } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { relativeTime } from '@/components/ui/doc-icon';
import { Badge, Button, Field, Result, TextInput, Toggle } from '@/components/settings/ui';
import { api } from '@/lib/api';
import { useAdminMutation, useAdminUsers } from '@/lib/admin-queries';
import { useSession } from '@/lib/session';

const PROVIDER_LABEL = { local: 'Email', entra: 'Microsoft', ldap: 'Domain' } as const;
const ROLES: SystemRole[] = ['admin', 'editor', 'viewer'];
const ROLE_HINT: Record<SystemRole, string> = {
  admin: 'Everything, including Settings, users and every space.',
  editor: 'Creates spaces and edits wherever they have been given edit access.',
  viewer: 'Read-only everywhere, whatever a space grants them.',
};

function AddUserSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const create = useAdminMutation((body: Record<string, string>) => api('/admin/users', { method: 'POST', json: body }));
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    await create.mutateAsync(Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>);
    onOpenChange(false);
  };
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title="Add user" description="Creates an email/password account. Directory users appear automatically after a sync.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Full name">
          <TextInput name="displayName" required />
        </Field>
        <Field label="Email">
          <TextInput name="email" type="email" required autoCapitalize="none" />
        </Field>
        <Field label="Initial password" hint="At least 10 characters. Share it securely; they can be given a new one any time.">
          <TextInput name="password" type="password" required minLength={10} autoComplete="new-password" />
        </Field>
        <Field label="Role">
          <select name="role" defaultValue="editor" className="w-full rounded-xl bg-surface-2 px-3.5 py-2.5 outline-none ring-accent focus:ring-2">
            <option value="editor">Editor — create and edit content</option>
            <option value="viewer">Viewer — read-only</option>
            <option value="admin">Admin — full control</option>
          </select>
        </Field>
        {create.error && <Result result={{ ok: false, message: create.error.message }} />}
        <Button type="submit" busy={create.isPending} className="w-full">
          Create user
        </Button>
      </form>
    </BottomSheet>
  );
}

function UserSheet({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const { user: me } = useSession();
  const update = useAdminMutation((patch: Partial<Pick<AdminUser, 'role' | 'active'>>) => api(`/admin/users/${user.id}`, { method: 'PATCH', json: patch }));
  const setPassword = useAdminMutation((password: string) => api(`/admin/users/${user.id}/password`, { method: 'POST', json: { password } }));
  const [pw, setPw] = useState('');
  const [role, setRole] = useState(user.role);
  const [active, setActive] = useState(user.active);

  return (
    <BottomSheet open onOpenChange={(v) => !v && onClose()} title={user.displayName} description={user.email}>
      <div className="space-y-5">
        <div className="flex flex-wrap gap-1.5">
          {user.providers.map((p) => (
            <Badge key={p}>{PROVIDER_LABEL[p]}</Badge>
          ))}
          <Badge>{user.groups} groups</Badge>
          {user.lastLoginAt && <Badge>Last seen {relativeTime(user.lastLoginAt)}</Badge>}
        </div>

        <Field label="Role" hint={ROLE_HINT[role]}>
          <div className="flex gap-1 rounded-pill bg-surface-2 p-1">
            {ROLES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => {
                  setRole(r);
                  update.mutate({ role: r });
                }}
                className={`flex-1 rounded-pill py-2 text-sm font-semibold capitalize ${role === r ? 'bg-surface shadow-card' : 'text-ink-3'}`}
              >
                {r}
              </button>
            ))}
          </div>
        </Field>

        <Toggle
          label="Active"
          hint="Inactive users can't sign in and are signed out everywhere."
          checked={active}
          disabled={user.id === me?.id}
          onChange={(v) => {
            setActive(v);
            update.mutate({ active: v });
          }}
        />

        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            setPassword.mutate(pw, { onSuccess: () => setPw('') });
          }}
        >
          <Field label="Set password" hint={user.providers.includes('local') ? 'Replaces their email/password login password.' : 'Adds an email/password login alongside their directory account.'}>
            <div className="flex gap-2">
              <TextInput type="password" value={pw} onChange={(e) => setPw(e.target.value)} minLength={10} autoComplete="new-password" placeholder="New password (10+ characters)" />
              <Button type="submit" variant="secondary" busy={setPassword.isPending} disabled={pw.length < 10}>
                <KeyRound className="size-4" />
              </Button>
            </div>
          </Field>
          {setPassword.isSuccess && <Result result={{ ok: true, message: 'Password updated. Existing sessions were signed out.' }} />}
        </form>

        {(update.error || setPassword.error) && <Result result={{ ok: false, message: (update.error ?? setPassword.error)!.message }} />}
      </div>
    </BottomSheet>
  );
}

export default function UsersSettingsPage() {
  const [q, setQ] = useState('');
  const deferred = useDeferredValue(q);
  const { data, isPending } = useAdminUsers(deferred);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<AdminUser | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <label className="flex flex-1 items-center gap-2 rounded-2xl bg-surface px-4 shadow-card ring-accent focus-within:ring-2">
          <Search className="size-4 text-ink-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search users" className="min-w-0 flex-1 bg-transparent py-3 outline-none" />
        </label>
        <Button onClick={() => setAdding(true)}>
          <UserPlus className="size-4" /> <span className="hidden sm:inline">Add user</span>
        </Button>
      </div>

      <div className="overflow-hidden rounded-card bg-surface shadow-card">
        {isPending && <div className="h-40 animate-pulse" />}
        {data?.map((u, i) => (
          <button key={u.id} onClick={() => setSelected(u)} className={`press flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2 ${i ? 'border-t border-line' : ''} ${u.active ? '' : 'opacity-55'}`}>
            <Avatar name={u.displayName} size={38} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{u.displayName}</span>
              <span className="block truncate text-meta text-ink-3">{u.email}</span>
            </span>
            <span className="hidden gap-1 sm:flex">
              {u.providers.map((p) => (
                <Badge key={p}>{PROVIDER_LABEL[p]}</Badge>
              ))}
            </span>
            <Badge tone={u.role === 'admin' ? 'accent' : u.role === 'viewer' ? 'neutral' : 'success'}>{u.role}</Badge>
            {!u.active && <Badge tone="danger">inactive</Badge>}
          </button>
        ))}
        {data?.length === 0 && <p className="p-8 text-center text-ink-3">No users found.</p>}
      </div>

      <AddUserSheet open={adding} onOpenChange={setAdding} />
      {selected && <UserSheet key={selected.id} user={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
