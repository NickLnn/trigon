'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PERMISSION_LEVELS, type EffectiveGrant, type PermissionLevel } from '@trigon/shared';
import { Globe, Loader2, Search, UserRound, Users, X } from 'lucide-react';
import { useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { api } from '@/lib/api';
import { useEffectiveGrants } from '@/lib/queries';

const LEVEL_LABEL: Record<PermissionLevel, string> = { view: 'Can view', comment: 'Can comment', edit: 'Can edit', manage: 'Full access' };

type Candidate = { type: 'user' | 'group' | 'everyone'; id: string | null; name: string; detail: string | null };

function SubjectIcon({ grant }: { grant: Pick<EffectiveGrant, 'subjectType' | 'subjectName'> }) {
  if (grant.subjectType === 'user') return <Avatar name={grant.subjectName} size={34} />;
  return (
    <span className="grid size-[34px] shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
      {grant.subjectType === 'group' ? <Users className="size-4" /> : <Globe className="size-4" />}
    </span>
  );
}

function LevelSelect({ value, onChange, disabled }: { value: PermissionLevel; onChange: (v: PermissionLevel) => void; disabled?: boolean }) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as PermissionLevel)}
      className="rounded-lg bg-surface-2 px-2 py-1.5 text-sm font-medium outline-none ring-accent focus:ring-2 disabled:opacity-60"
    >
      {PERMISSION_LEVELS.map((l) => (
        <option key={l} value={l}>
          {LEVEL_LABEL[l]}
        </option>
      ))}
    </select>
  );
}

/**
 * Share dialog for a space, folder, page or file. Shows direct grants (editable) and grants inherited
 * from parent folders and the space (read-only), and lets managers add users, groups or everyone.
 */
export function ShareSheet({
  open,
  onOpenChange,
  type,
  id,
  name,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  type: 'space' | 'document';
  id: string;
  name: string;
}) {
  const qc = useQueryClient();
  const grants = useEffectiveGrants(type, id, open);
  const [q, setQ] = useState('');
  const [level, setLevel] = useState<PermissionLevel>('view');
  const term = q.trim();

  const candidates = useQuery({
    queryKey: ['share-search', term],
    enabled: open && term.length > 1,
    queryFn: async (): Promise<Candidate[]> => {
      const [people, groups] = await Promise.all([
        api<{ id: string; email: string; displayName: string }[]>(`/users?q=${encodeURIComponent(term)}`),
        api<{ id: string; name: string; source: string }[]>(`/groups?q=${encodeURIComponent(term)}`),
      ]);
      return [
        ...groups.map((g) => ({ type: 'group' as const, id: g.id, name: g.name, detail: g.source === 'entra' ? 'Microsoft group' : g.source === 'ldap' ? 'LDAP group' : 'Trigon group' })),
        ...people.map((u) => ({ type: 'user' as const, id: u.id, name: u.displayName, detail: u.email })),
      ];
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['grants'] });
    qc.invalidateQueries({ queryKey: ['spaces'] });
  };
  const grant = useMutation({
    mutationFn: (c: { subjectType: Candidate['type']; subjectId: string | null; level: PermissionLevel }) =>
      api('/permissions', { method: 'POST', json: { resourceType: type, resourceId: id, subjectType: c.subjectType, subjectId: c.subjectId ?? undefined, level: c.level } }),
    onSuccess: () => {
      setQ('');
      refresh();
    },
  });
  const revoke = useMutation({ mutationFn: (grantId: string) => api(`/permissions/${grantId}`, { method: 'DELETE' }), onSuccess: refresh });

  const direct = grants.data?.filter((g) => !g.inherited) ?? [];
  const inherited = grants.data?.filter((g) => g.inherited) ?? [];
  const hasEveryone = direct.some((g) => g.subjectType === 'everyone');
  const existing = new Set(direct.map((g) => `${g.subjectType}:${g.subjectId}`));
  const results = (candidates.data ?? []).filter((c) => !existing.has(`${c.type}:${c.id}`)).slice(0, 8);
  const forbidden = grants.error && (grants.error as { status?: number }).status === 403;

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title={`Share “${name}”`} description="People get the strongest access from this item, its folders and the space.">
      {forbidden ? (
        <p className="rounded-xl bg-surface-2 p-4 text-sm text-ink-2">You need full access to this {type === 'space' ? 'space' : 'item'} to manage who can see it.</p>
      ) : (
        <div className="space-y-5">
          <div>
            <div className="flex gap-2">
              <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-surface-2 px-3 ring-accent focus-within:ring-2">
                <Search className="size-4 shrink-0 text-ink-3" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add people or groups" className="min-w-0 flex-1 bg-transparent py-2.5 outline-none" />
              </label>
              <LevelSelect value={level} onChange={setLevel} />
            </div>
            {(results.length > 0 || (!hasEveryone && term.length > 1)) && (
              <div className="mt-1.5 overflow-hidden rounded-xl border border-line">
                {results.map((c) => (
                  <button
                    key={`${c.type}:${c.id}`}
                    onClick={() => grant.mutate({ subjectType: c.type, subjectId: c.id, level })}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-2"
                  >
                    {c.type === 'group' ? <Users className="size-4 text-accent" /> : <UserRound className="size-4 text-accent" />}
                    <span className="min-w-0 flex-1 truncate text-sm">
                      <b className="font-semibold">{c.name}</b> <span className="text-ink-3">· {c.detail}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
            {!hasEveryone && (
              <button
                onClick={() => grant.mutate({ subjectType: 'everyone', subjectId: null, level })}
                className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-accent"
              >
                <Globe className="size-4" /> Give everyone in Trigon “{LEVEL_LABEL[level].toLowerCase()}”
              </button>
            )}
          </div>

          <section>
            <h3 className="mb-1 text-meta font-semibold uppercase tracking-wider text-ink-3">On this {type === 'space' ? 'space' : 'item'}</h3>
            {grants.isPending && <Loader2 className="my-3 size-4 animate-spin text-ink-3" />}
            {!grants.isPending && direct.length === 0 && <p className="py-2 text-sm text-ink-3">No direct access yet{inherited.length ? ' — access comes from above.' : '.'}</p>}
            <ul>
              {direct.map((g) => (
                <li key={g.id} className="flex items-center gap-3 py-2">
                  <SubjectIcon grant={g} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{g.subjectName}</span>
                    {g.subjectDetail && <span className="block truncate text-meta text-ink-3">{g.subjectDetail}</span>}
                  </span>
                  <LevelSelect value={g.level} onChange={(lv) => grant.mutate({ subjectType: g.subjectType, subjectId: g.subjectId, level: lv })} />
                  <button onClick={() => revoke.mutate(g.id)} className="rounded-full p-1.5 text-ink-3 hover:bg-surface-2 hover:text-danger" aria-label={`Remove ${g.subjectName}`}>
                    <X className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {inherited.length > 0 && (
            <section>
              <h3 className="mb-1 text-meta font-semibold uppercase tracking-wider text-ink-3">Inherited</h3>
              <ul>
                {inherited.map((g) => (
                  <li key={g.id} className="flex items-center gap-3 py-2 opacity-90">
                    <SubjectIcon grant={g} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{g.subjectName}</span>
                      <span className="block truncate text-meta text-ink-3">
                        from {g.resourceType === 'space' ? 'space' : 'folder'} “{g.resourceName}”
                      </span>
                    </span>
                    <span className="rounded-lg bg-surface-2 px-2 py-1.5 text-sm text-ink-2">{LEVEL_LABEL[g.level]}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-meta text-ink-3">Change inherited access on the folder or space it comes from.</p>
            </section>
          )}

          <p className="rounded-xl bg-surface-2 px-3 py-2.5 text-meta text-ink-2">
            Admins always have full access. People with the <b>Viewer</b> role stay read-only, whatever they&apos;re given here.
          </p>
          {(grant.error || revoke.error) && <p className="text-sm text-danger">{(grant.error ?? revoke.error)!.message}</p>}
        </div>
      )}
    </BottomSheet>
  );
}
