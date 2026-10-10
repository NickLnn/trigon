'use client';

import { useQueryClient } from '@tanstack/react-query';
import type { EntraSettings } from '@trigon/shared';
import { Check, Copy, ExternalLink, RefreshCw, Sparkles, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { EntraScopeSheet } from '@/components/settings/entra-scope-sheet';
import { SyncStatus } from '@/components/settings/sync-status';
import { Badge, Button, Field, Result, SettingsCard, TextInput, Toggle } from '@/components/settings/ui';
import { useDirectoryStatus, useProvisionStatus, useSaveSettings, useSettings, useStartProvision, useSyncNow, useTestConnection } from '@/lib/admin-queries';

/** "Connect to Microsoft": device-code sign-in, then Trigon creates and consents its own app registration. */
function ConnectSheet({ open, onOpenChange, onNext }: { open: boolean; onOpenChange: (v: boolean) => void; onNext: () => void }) {
  const start = useStartProvision();
  const status = useProvisionStatus(open);
  const s = status.data;
  const [copied, setCopied] = useState(false);
  const active = s?.state === 'waiting_for_sign_in' || s?.state === 'working';
  const qc = useQueryClient();

  useEffect(() => {
    if (s?.state === 'done') {
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['directory-status'] });
    }
  }, [s?.state, qc]);

  useEffect(() => {
    if (open && !active && s?.state !== 'done') start.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title="Connect to Microsoft" description="Sign in with a Global Administrator (or Privileged Role Administrator) account of your tenant.">
      {s?.state === 'waiting_for_sign_in' && s.userCode && (
        <div className="rounded-2xl bg-surface-2 p-5 text-center">
          <p className="text-sm text-ink-2">1. Open the Microsoft sign-in page</p>
          <a
            href={s.verificationUri}
            target="_blank"
            rel="noopener noreferrer"
            className="press mt-2 inline-flex items-center gap-2 rounded-pill bg-accent px-5 py-2.5 font-semibold text-accent-ink"
          >
            microsoft.com/devicelogin <ExternalLink className="size-4" />
          </a>
          <p className="mt-5 text-sm text-ink-2">2. Enter this code</p>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(s.userCode!);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="press mt-2 inline-flex items-center gap-3 rounded-2xl bg-surface px-5 py-3 font-mono text-2xl font-bold tracking-[0.2em] shadow-card"
          >
            {s.userCode}
            {copied ? <Check className="size-5 text-success" /> : <Copy className="size-5 text-ink-3" />}
          </button>
          <p className="mt-5 text-meta text-ink-3">3. Approve the requested permissions. This page continues automatically.</p>
        </div>
      )}

      {s && s.state !== 'idle' && (
        <ol className="mt-5 space-y-2.5">
          {s.steps.map((step, i) => {
            const running = !step.done && (i === 0 || s.steps[i - 1].done) && active;
            return (
              <li key={step.label} className="flex items-center gap-3 text-sm">
                <span
                  className={`grid size-6 shrink-0 place-items-center rounded-full ${step.done ? 'bg-success text-white' : running ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-ink-3'}`}
                >
                  {step.done ? <Check className="size-3.5" /> : running ? <RefreshCw className="size-3.5 animate-spin" /> : i + 1}
                </span>
                <span className={step.done ? '' : 'text-ink-2'}>{step.label}</span>
              </li>
            );
          })}
        </ol>
      )}

      {s?.state === 'done' && (
        <div className="mt-5 space-y-3">
          <Result result={{ ok: true, message: s.message ?? 'Connected.' }} />
          <Button
            className="w-full"
            onClick={() => {
              onOpenChange(false);
              onNext();
            }}
          >
            <Users className="size-4" /> Next: choose who gets access
          </Button>
        </div>
      )}
      {(s?.state === 'error' || start.error) && (
        <div className="mt-5 space-y-3">
          <Result result={{ ok: false, message: s?.message ?? start.error?.message ?? 'Something went wrong' }} />
          <Button onClick={() => start.mutate()} busy={start.isPending}>
            Try again
          </Button>
        </div>
      )}
      {!s && start.isPending && <p className="text-center text-ink-3">Contacting Microsoft…</p>}
    </BottomSheet>
  );
}

export default function EntraSettingsPage() {
  const { data } = useSettings();
  const save = useSaveSettings('entra');
  const test = useTestConnection('entra');
  const sync = useSyncNow('entra');
  const dir = useDirectoryStatus();
  const [form, setForm] = useState<EntraSettings | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);

  useEffect(() => {
    if (data) setForm({ ...data.entra, clientSecret: '' });
  }, [data]);

  if (!data || !form) return <div className="h-60 animate-pulse rounded-card bg-surface" />;
  const set = (patch: Partial<EntraSettings>) => setForm((f) => ({ ...f!, ...patch }));
  // Only the manually editable fields — the API rejects read-only ones (hasClientSecret, scope…).
  const payload = () => ({ enabled: form.enabled, tenantId: form.tenantId, clientId: form.clientId, clientSecret: form.clientSecret, redirectUri: form.redirectUri, syncCron: form.syncCron }) as EntraSettings;
  const configured = data.entra.enabled && !!data.entra.clientId && data.entra.hasClientSecret;
  const stats = dir.data?.entra;

  return (
    <div className="space-y-5">
      <SettingsCard
        title={configured ? 'Connected' : 'Connect in one click'}
        description={
          configured
            ? `Tenant ${data.entra.tenantId} · App ${data.entra.clientId}${data.entra.provisionedAppId ? ' (created by Trigon)' : ''}`
            : 'Sign in once as a Microsoft admin: Trigon registers its own app in your tenant, grants it read access to users and groups, and saves the credentials. No Azure portal needed.'
        }
        actions={configured ? <Badge tone="success">Active</Badge> : undefined}
      >
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setConnectOpen(true)}>
            <Sparkles className="size-4" /> {configured ? 'Reconnect' : 'Connect to Microsoft'}
          </Button>
          {configured && (
            <Button variant="secondary" busy={sync.isPending || stats?.running} onClick={() => sync.mutate()}>
              <RefreshCw className="size-4" /> Sync users & groups now
            </Button>
          )}
        </div>
        {stats && configured && (
          <p className="mt-3 text-sm text-ink-2">
            {stats.accounts} Microsoft users linked
            {stats.lastGroupSync ? ` · last sync ${new Date(stats.lastGroupSync).toLocaleString()}` : ' · not synced yet'}
          </p>
        )}
        {configured && (
          <div className="mt-3">
            <SyncStatus status={stats} />
          </div>
        )}
        {sync.error && <div className="mt-3"><Result result={{ ok: false, message: sync.error.message }} /></div>}
        {data.info.httpsWarning && (
          <p className="mt-4 rounded-xl bg-warning/12 px-3.5 py-2.5 text-sm">
            Directory sync works over HTTP. <b>Sign in with Microsoft</b> needs Trigon on HTTPS, because Microsoft rejects http:// redirect addresses other than localhost.
          </p>
        )}
      </SettingsCard>

      {configured && (
        <SettingsCard
          title="Who gets access"
          description={
            data.entra.syncScope === 'all'
              ? 'Everyone in the tenant is synced and can sign in with Microsoft.'
              : data.entra.syncGroups.length || data.entra.syncUsers.length
                ? 'Only these groups (with their members) and people are synced and can sign in.'
                : 'Nobody is synced yet — choose groups or people to bring into Trigon.'
          }
          actions={<Badge tone={data.entra.syncScope === 'all' ? 'warning' : 'accent'}>{data.entra.syncScope === 'all' ? 'Whole tenant' : 'Selected'}</Badge>}
        >
          {data.entra.syncScope === 'selected' && (data.entra.syncGroups.length > 0 || data.entra.syncUsers.length > 0) && (
            <div className="mb-4 flex flex-wrap gap-1.5">
              {data.entra.syncGroups.map((g) => (
                <span key={g.id} className="inline-flex items-center gap-1.5 rounded-pill bg-accent-soft px-3 py-1 text-sm font-medium text-accent">
                  <Users className="size-3.5" /> {g.name}
                </span>
              ))}
              {data.entra.syncUsers.map((u) => (
                <span key={u.id} className="inline-flex items-center rounded-pill bg-surface-2 px-3 py-1 text-sm font-medium text-ink-2">
                  {u.name}
                </span>
              ))}
            </div>
          )}
          <Button variant={data.entra.syncScope === 'selected' && !data.entra.syncGroups.length && !data.entra.syncUsers.length ? 'primary' : 'secondary'} onClick={() => setScopeOpen(true)}>
            <Users className="size-4" /> Choose groups and people
          </Button>
        </SettingsCard>
      )}

      <SettingsCard title="Manual configuration" description="Already have an app registration? Enter its details here.">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(payload());
          }}
        >
          <Toggle label="Enable Microsoft Entra ID" checked={form.enabled} onChange={(v) => set({ enabled: v })} />
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Directory (tenant) ID">
              <TextInput value={form.tenantId} onChange={(e) => set({ tenantId: e.target.value.trim() })} placeholder="00000000-0000-0000-0000-000000000000" />
            </Field>
            <Field label="Application (client) ID">
              <TextInput value={form.clientId} onChange={(e) => set({ clientId: e.target.value.trim() })} placeholder="00000000-0000-0000-0000-000000000000" />
            </Field>
          </div>
          <Field label="Client secret" hint={data.entra.hasClientSecret ? 'A secret is stored. Leave empty to keep it.' : undefined}>
            <TextInput type="password" autoComplete="new-password" value={form.clientSecret ?? ''} onChange={(e) => set({ clientSecret: e.target.value })} placeholder={data.entra.hasClientSecret ? '••••••••••••' : 'Secret value'} />
          </Field>
          <Field label="Redirect URI" hint={`Leave empty to use ${data.info.appUrl}/api/auth/entra/callback`}>
            <TextInput value={form.redirectUri} onChange={(e) => set({ redirectUri: e.target.value.trim() })} placeholder={`${data.info.appUrl}/api/auth/entra/callback`} />
          </Field>
          <Field label="Sync schedule (cron)" hint="Default every 6 hours. Leave empty to sync only manually.">
            <TextInput value={form.syncCron} onChange={(e) => set({ syncCron: e.target.value })} placeholder="0 */6 * * *" />
          </Field>
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

      <ConnectSheet open={connectOpen} onOpenChange={setConnectOpen} onNext={() => setScopeOpen(true)} />
      <EntraScopeSheet
        open={scopeOpen}
        onOpenChange={setScopeOpen}
        initial={{ syncScope: data.entra.syncScope ?? 'all', syncGroups: data.entra.syncGroups ?? [], syncUsers: data.entra.syncUsers ?? [] }}
      />
    </div>
  );
}
