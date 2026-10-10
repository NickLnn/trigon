'use client';

import type { LdapSettings } from '@trigon/shared';
import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { SyncStatus } from '@/components/settings/sync-status';
import { Badge, Button, Field, Result, SettingsCard, TextInput, Toggle } from '@/components/settings/ui';
import { useDirectoryStatus, useSaveSettings, useSettings, useSyncNow, useTestConnection } from '@/lib/admin-queries';

export default function LdapSettingsPage() {
  const { data } = useSettings();
  const save = useSaveSettings('ldap');
  const test = useTestConnection('ldap');
  const sync = useSyncNow('ldap');
  const dir = useDirectoryStatus();
  const [form, setForm] = useState<LdapSettings | null>(null);

  useEffect(() => {
    if (data) setForm({ ...data.ldap, bindPassword: '' });
  }, [data]);

  if (!data || !form) return <div className="h-60 animate-pulse rounded-card bg-surface" />;
  const set = (patch: Partial<LdapSettings>) => setForm((f) => ({ ...f!, ...patch }));
  // Strip read-only flags (hasBindPassword) — the API rejects unknown fields.
  const payload = () => {
    const { hasBindPassword: _ignored, ...rest } = form;
    return rest as LdapSettings;
  };
  const stats = dir.data?.ldap;
  const active = data.ldap.enabled && !!data.ldap.url;

  return (
    <div className="space-y-5">
      {active && (
        <SettingsCard title="Directory" actions={<Badge tone="success">Active</Badge>} description={data.ldap.url}>
          <Button variant="secondary" busy={sync.isPending || stats?.running} onClick={() => sync.mutate()}>
            <RefreshCw className="size-4" /> Sync users & groups now
          </Button>
          {stats && (
            <p className="mt-3 text-sm text-ink-2">
              {stats.accounts} domain users linked
              {stats.lastGroupSync ? ` · last sync ${new Date(stats.lastGroupSync).toLocaleString()}` : ' · not synced yet'}
            </p>
          )}
          <div className="mt-3">
            <SyncStatus status={stats} />
          </div>
          {sync.error && <div className="mt-3"><Result result={{ ok: false, message: sync.error.message }} /></div>}
        </SettingsCard>
      )}

      <SettingsCard title="Connection" description="Users sign in with their domain account; groups sync on a schedule and can be used for permissions.">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(payload());
          }}
        >
          <Toggle label="Enable LDAP / Active Directory" checked={form.enabled} onChange={(v) => set({ enabled: v })} />
          <Field label="Server URL" hint="ldaps://dc01.corp.local:636 (recommended) or ldap://…:389">
            <TextInput value={form.url} onChange={(e) => set({ url: e.target.value.trim() })} placeholder="ldaps://dc01.corp.local:636" />
          </Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Bind DN (service account)">
              <TextInput value={form.bindDn} onChange={(e) => set({ bindDn: e.target.value })} placeholder="CN=svc-trigon,OU=Service,DC=corp,DC=local" />
            </Field>
            <Field label="Bind password" hint={data.ldap.hasBindPassword ? 'A password is stored. Leave empty to keep it.' : undefined}>
              <TextInput
                type="password"
                autoComplete="new-password"
                value={form.bindPassword ?? ''}
                onChange={(e) => set({ bindPassword: e.target.value })}
                placeholder={data.ldap.hasBindPassword ? '••••••••••••' : ''}
              />
            </Field>
          </div>
          <Field label="Search base">
            <TextInput value={form.searchBase} onChange={(e) => set({ searchBase: e.target.value })} placeholder="DC=corp,DC=local" />
          </Field>
          <details className="rounded-xl bg-surface-2/60 p-4">
            <summary className="cursor-pointer text-sm font-semibold">Advanced filters & schedule</summary>
            <div className="mt-4 space-y-4">
              <Field label="Login filter" hint="{{username}} is replaced by what the user types.">
                <TextInput value={form.userFilter} onChange={(e) => set({ userFilter: e.target.value })} className="font-mono text-sm" />
              </Field>
              <Field label="User sync filter">
                <TextInput value={form.syncUserFilter} onChange={(e) => set({ syncUserFilter: e.target.value })} className="font-mono text-sm" />
              </Field>
              <Field label="Group sync filter">
                <TextInput value={form.groupFilter} onChange={(e) => set({ groupFilter: e.target.value })} className="font-mono text-sm" />
              </Field>
              <Field label="Sync schedule (cron)" hint="Leave empty to sync only manually.">
                <TextInput value={form.syncCron} onChange={(e) => set({ syncCron: e.target.value })} placeholder="30 */6 * * *" />
              </Field>
              <Toggle
                label="Verify TLS certificate"
                hint="Turn off only for self-signed domain controller certificates."
                checked={form.tlsRejectUnauthorized}
                onChange={(v) => set({ tlsRejectUnauthorized: v })}
              />
            </div>
          </details>
          <Result result={test.data} />
          {test.error && <Result result={{ ok: false, message: test.error.message }} />}
          {save.error && <Result result={{ ok: false, message: save.error.message }} />}
          {save.isSuccess && !save.isPending && <Result result={{ ok: true, message: 'Saved.' }} />}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" busy={save.isPending}>
              Save
            </Button>
            <Button type="button" variant="secondary" busy={test.isPending} onClick={() => test.mutate(payload())}>
              Test connection
            </Button>
          </div>
        </form>
      </SettingsCard>
    </div>
  );
}
