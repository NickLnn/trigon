'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronRight, LogOut, Monitor, Moon, RefreshCw, Sun } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { PageHeader } from '@/components/shell/page-header';
import { Avatar } from '@/components/ui/avatar';
import { api } from '@/lib/api';
import { useSession, useSignOut } from '@/lib/session';

type Theme = 'system' | 'light' | 'dark';

interface DirectoryStatus {
  entra: { enabled: boolean; running: boolean; lastGroupSync: string | null; accounts: number };
  ldap: { enabled: boolean; running: boolean; lastGroupSync: string | null; accounts: number };
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 px-1 text-meta font-semibold uppercase tracking-wider text-ink-3">{title}</h2>
      <div className="overflow-hidden rounded-card bg-surface shadow-card [&>*+*]:border-t [&>*+*]:border-line">{children}</div>
    </section>
  );
}

function Row({ icon, label, value, onClick }: { icon?: ReactNode; label: string; value?: ReactNode; onClick?: () => void }) {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp onClick={onClick} className={`flex w-full items-center gap-3 px-4 py-3.5 text-left ${onClick ? 'press hover:bg-surface-2' : ''}`}>
      {icon && <span className="grid size-9 place-items-center rounded-full bg-surface-2 text-ink-2">{icon}</span>}
      <span className="flex-1 font-medium">{label}</span>
      {value !== undefined && <span className="text-ink-3">{value}</span>}
      {onClick && <ChevronRight className="size-4 text-ink-3" />}
    </Comp>
  );
}

function DirectorySync() {
  const status = useQuery({ queryKey: ['directory-status'], queryFn: () => api<DirectoryStatus>('/directory/status') });
  const sync = useMutation({
    mutationFn: (source: 'entra' | 'ldap') => api(`/directory/sync/${source}`, { method: 'POST' }),
    onSettled: () => status.refetch(),
  });
  if (!status.data) return null;
  const sources = (['entra', 'ldap'] as const).filter((s) => status.data[s].enabled);
  if (!sources.length) return null;
  return (
    <Group title="Directory sync (admin)">
      {sources.map((s) => {
        const info = status.data[s];
        return (
          <Row
            key={s}
            icon={<RefreshCw className={`size-4 ${info.running || (sync.isPending && sync.variables === s) ? 'animate-spin' : ''}`} />}
            label={s === 'entra' ? 'Microsoft Entra ID' : 'LDAP / Active Directory'}
            value={`${info.accounts} users${info.lastGroupSync ? ` · ${new Date(info.lastGroupSync).toLocaleString()}` : ''}`}
            onClick={() => sync.mutate(s)}
          />
        );
      })}
      {sync.error && <p className="px-4 py-3 text-sm text-danger">{sync.error.message}</p>}
    </Group>
  );
}

export default function ProfilePage() {
  const { user } = useSession();
  const signOut = useSignOut();
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    try {
      setTheme((localStorage.getItem('trigon.theme') as Theme) ?? 'system');
    } catch {
      /* storage unavailable */
    }
  }, []);

  const applyTheme = (t: Theme) => {
    setTheme(t);
    try {
      if (t === 'system') localStorage.removeItem('trigon.theme');
      else localStorage.setItem('trigon.theme', t);
    } catch {
      /* storage unavailable */
    }
    if (t === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
  };

  if (!user) return null;

  return (
    <>
      <PageHeader title="Profile" />
      <div className="mx-auto max-w-xl space-y-6 px-4 pb-12 md:px-10">
        <div className="flex flex-col items-center rounded-card bg-surface p-6 text-center shadow-card">
          <Avatar name={user.displayName} src={user.avatarUrl} size={80} />
          <p className="mt-3 text-title font-bold">{user.displayName}</p>
          <p className="text-ink-2">{user.email}</p>
          <div className="mt-3 flex gap-1.5">
            <span className="rounded-pill bg-accent-soft px-3 py-1 text-meta font-semibold capitalize text-accent">{user.role}</span>
            {user.providers.map((p) => (
              <span key={p} className="rounded-pill bg-surface-2 px-3 py-1 text-meta font-medium text-ink-2">
                {p === 'entra' ? 'Microsoft' : p === 'ldap' ? 'Domain' : 'Email'}
              </span>
            ))}
          </div>
        </div>

        <Group title="Appearance">
          <div className="flex gap-1 p-2">
            {(
              [
                ['system', Monitor, 'Auto'],
                ['light', Sun, 'Light'],
                ['dark', Moon, 'Dark'],
              ] as const
            ).map(([t, Icon, label]) => (
              <button
                key={t}
                onClick={() => applyTheme(t)}
                className={`press flex flex-1 flex-col items-center gap-1.5 rounded-2xl py-3 text-sm font-medium ${theme === t ? 'bg-accent-soft text-accent' : 'text-ink-2 hover:bg-surface-2'}`}
              >
                <Icon className="size-5" />
                {label}
              </button>
            ))}
          </div>
        </Group>

        {user.role === 'admin' && <DirectorySync />}

        <Group title="Account">
          <Row icon={<LogOut className="size-4" />} label="Sign out" onClick={signOut} />
        </Group>
      </div>
    </>
  );
}
