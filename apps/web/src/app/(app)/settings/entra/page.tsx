'use client';

import { useQueryClient } from '@tanstack/react-query';
import type { EntraSettings, EntraSignInStatus } from '@trigon/shared';
import { Check, Copy, ExternalLink, Globe, Mail, RefreshCw, ShieldCheck, Sparkles, Unplug, Users } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { EntraScopeSheet } from '@/components/settings/entra-scope-sheet';
import { SyncStatus } from '@/components/settings/sync-status';
import { Badge, Button, Field, Result, SettingsCard, TextInput, Toggle } from '@/components/settings/ui';
import {
  useDirectoryStatus,
  useDisconnectEntra,
  useProvisionStatus,
  useSaveSettings,
  useSettings,
  useStartProvision,
  useSyncNow,
  useTestConnection,
} from '@/lib/admin-queries';

/** The address the admin is on, if Microsoft would accept it as a sign-in redirect. */
function currentHttpsOrigin() {
  if (typeof window === 'undefined') return '';
  const { origin, protocol, hostname } = window.location;
  return protocol === 'https:' || hostname === 'localhost' ? origin : '';
}

function validPublicUrl(v: string) {
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || (u.protocol === 'http:' && u.hostname === 'localhost');
  } catch {
    return false;
  }
}

/** What the "Trigon" app registration is granted, shown before the admin signs in. */
const BASE_PERMISSIONS = [
  { name: 'User.Read.All', what: 'Read user profiles', why: 'Imports people and keeps names and email addresses current.' },
  { name: 'Group.Read.All · GroupMember.Read.All', what: 'Read groups and their members', why: 'Lets you share spaces with Microsoft groups.' },
  { name: 'Application.ReadWrite.OwnedBy', what: 'Manage only its own app registration', why: 'Adds new sign-in addresses later without an admin.' },
  { name: 'openid · profile · email · User.Read', what: 'Sign people in', why: '“Sign in with Microsoft”, on behalf of the person signing in.' },
] as const;

const MAIL_PERMISSION = {
  name: 'Mail.Send',
  what: 'Send mail as any mailbox in your organisation',
  why: 'Trigon only sends notifications from the one sender mailbox you choose in Settings → Email. You can lock it to that mailbox with an Exchange application access policy.',
};

function PermissionRow({ p, optional }: { p: { name: string; what: string; why: string }; optional?: boolean }) {
  return (
    <li className="flex gap-3 py-2.5">
      {optional ? <Mail className="mt-0.5 size-4 shrink-0 text-accent" /> : <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />}
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{p.what}</span>
        <span className="block font-mono text-meta text-ink-3">{p.name}</span>
        <span className="block text-meta text-ink-2">{p.why}</span>
      </span>
    </li>
  );
}

/**
 * "Connect to Microsoft": the admin confirms Trigon's public HTTPS address, then signs in with a device
 * code and Trigon creates (or updates) and consents its own app registration.
 */
function ConnectSheet({
  open,
  onOpenChange,
  onNext,
  known,
  mailDefault,
  mailGranted,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onNext: () => void;
  known: string[];
  /** Pre-select "send email through Exchange Online" (opened from Settings → Email, or already granted). */
  mailDefault: boolean;
  /** Mail.Send was granted by an earlier connection; declining now removes it. */
  mailGranted: boolean;
}) {
  const start = useStartProvision();
  const status = useProvisionStatus(open);
  const s = status.data;
  const [copied, setCopied] = useState(false);
  const [publicUrl, setPublicUrl] = useState('');
  const [stage, setStage] = useState<'address' | 'mail' | 'running'>('address');
  const [mail, setMail] = useState(mailDefault);
  const confirmed = stage === 'running';
  const active = s?.state === 'waiting_for_sign_in' || s?.state === 'working';
  const qc = useQueryClient();

  useEffect(() => {
    if (s?.state === 'done') {
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['directory-status'] });
    }
  }, [s?.state, qc]);

  // Every new run starts with the address check; a run already in progress is shown as is.
  useEffect(() => {
    if (!open) return;
    setStage('address');
    setMail(mailDefault);
    start.reset();
    setPublicUrl(currentHttpsOrigin() || known.find((o) => o.startsWith('https://')) || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (stage === 'mail' && !active) {
    const begin = (withMail: boolean) => {
      setMail(withMail);
      setStage('running');
      start.mutate({ publicUrl: new URL(publicUrl).origin, mail: withMail });
    };
    return (
      <BottomSheet open={open} onOpenChange={onOpenChange} title="Send email through Exchange Online?" description="Trigon can send notifications from a mailbox in your Microsoft 365 organisation — no SMTP server needed.">
        <div className="space-y-4">
          <div className="rounded-2xl bg-surface-2/60 px-4 py-1">
            <p className="pt-3 text-meta font-semibold uppercase tracking-wide text-ink-3">Always granted to the “Trigon” app registration</p>
            <ul className="divide-y divide-line">
              {BASE_PERMISSIONS.map((p) => (
                <PermissionRow key={p.name} p={p} />
              ))}
            </ul>
          </div>
          <div className={`rounded-2xl px-4 py-1 ring-2 ${mail ? 'bg-accent-soft/40 ring-accent' : 'bg-surface-2/60 ring-transparent'}`}>
            <p className="pt-3 text-meta font-semibold uppercase tracking-wide text-ink-3">Only if you choose email through Exchange Online</p>
            <ul>
              <PermissionRow p={MAIL_PERMISSION} optional />
            </ul>
          </div>
          <p className="text-meta text-ink-3">
            All are application permissions approved once by you as administrator (admin consent). You can review or remove them any time under Microsoft Entra ID → App registrations → Trigon → API permissions.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button onClick={() => begin(true)}>
              <Mail className="size-4" /> Yes, use Exchange Online
            </Button>
            <Button variant="secondary" onClick={() => begin(false)}>
              {mailGranted ? 'No, remove email permission' : 'No, not now'}
            </Button>
          </div>
        </div>
      </BottomSheet>
    );
  }

  if (!confirmed && !active) {
    const ok = validPublicUrl(publicUrl);
    return (
      <BottomSheet open={open} onOpenChange={onOpenChange} title="Connect to Microsoft" description="First, confirm the address people use to open Trigon.">
        <div className="space-y-4">
          <Field
            label="Trigon's public address"
            hint="Microsoft only sends people back to HTTPS addresses after sign-in. Use the address you published (e.g. through Cloudflare), not an internal http:// one."
          >
            <TextInput value={publicUrl} onChange={(e) => setPublicUrl(e.target.value.trim())} placeholder="https://trigon.example.com" inputMode="url" />
          </Field>
          {ok && (
            <p className="flex items-start gap-2 rounded-xl bg-surface-2 px-3.5 py-2.5 text-sm text-ink-2">
              <Globe className="mt-0.5 size-4 shrink-0" />
              <span>
                Sign-in redirect: <span className="break-all font-mono text-meta text-ink">{new URL(publicUrl).origin}/api/auth/entra/callback</span>
              </span>
            </p>
          )}
          {publicUrl && !ok && <Result result={{ ok: false, message: 'Enter an https:// address, e.g. https://trigon.example.com' }} />}
          <Button
            className="w-full"
            disabled={!ok}
            onClick={() => setStage('mail')}
          >
            <Check className="size-4" /> This address is correct, continue
          </Button>
        </div>
      </BottomSheet>
    );
  }

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

      {s && s.state !== 'idle' && !start.isPending && !start.error && (
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

      {s?.state === 'done' && !start.isPending && !start.error && (
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
          {mail && (
            <Link
              href="/settings/email"
              onClick={() => onOpenChange(false)}
              className="press flex w-full items-center justify-center gap-2 rounded-pill bg-surface-2 px-4 py-2.5 text-sm font-semibold hover:bg-surface-3"
            >
              <Mail className="size-4" /> Set up email: choose the sender mailbox
            </Link>
          )}
        </div>
      )}
      {((s?.state === 'error' && !start.isPending) || start.error) && (
        <div className="mt-5 space-y-3">
          <Result result={{ ok: false, message: start.error?.message ?? s?.message ?? 'Something went wrong' }} />
          <Button onClick={() => setStage('address')}>
            Try again
          </Button>
        </div>
      )}
      {start.isPending && <p className="text-center text-ink-3">Contacting Microsoft…</p>}
    </BottomSheet>
  );
}

/** Whether "Sign in with Microsoft" can work at the addresses Trigon is opened at. */
function SignInStatus({ status, onReconnect }: { status: EntraSignInStatus; onReconnect: () => void }) {
  if (status.state === 'ok') {
    return (
      <div className="mt-4 text-sm text-ink-2">
        <p className="font-medium text-ink">Sign in with Microsoft works at:</p>
        <ul className="mt-1 space-y-0.5">
          {status.redirectUris.map((u) => (
            <li key={u} className="break-all font-mono text-meta">
              {new URL(u).origin}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (status.state === 'unknown' || !status.message) return null;
  return (
    <div className={`mt-4 rounded-xl px-3.5 py-2.5 text-sm ${status.state === 'error' ? 'bg-danger/10' : 'bg-warning/12'}`}>
      <p>{status.message}</p>
      {status.state === 'reconnect' && (
        <Button className="mt-2.5" onClick={onReconnect}>
          <Sparkles className="size-4" /> Reconnect
        </Button>
      )}
    </div>
  );
}

const DISCONNECT_PROMPT = (createdByTrigon: boolean) =>
  createdByTrigon
    ? 'Disconnect from Microsoft? Trigon deletes its app registration from your tenant; Microsoft sign-in and directory sync stop until you connect again.'
    : 'Disconnect from Microsoft? Microsoft sign-in and directory sync stop until you connect again. Your own app registration is left as is.';

export default function EntraSettingsPage() {
  const { data } = useSettings();
  const save = useSaveSettings('entra');
  const test = useTestConnection('entra');
  const sync = useSyncNow('entra');
  const dir = useDirectoryStatus();
  const [form, setForm] = useState<EntraSettings | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [mailRequested, setMailRequested] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const disconnect = useDisconnectEntra();

  useEffect(() => {
    if (data) setForm({ ...data.entra, clientSecret: '' });
  }, [data]);

  // Settings → Email links here with ?connect=mail to add the Exchange Online permission.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('connect') !== 'mail') return;
    setMailRequested(true);
    setConnectOpen(true);
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

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
          {!!data.entra.clientId && (
            <Button
              variant="danger"
              busy={disconnect.isPending}
              onClick={() => confirm(DISCONNECT_PROMPT(!!data.entra.provisionedAppId)) && disconnect.mutate()}
            >
              <Unplug className="size-4" /> Disconnect
            </Button>
          )}
        </div>
        {disconnect.data && <div className="mt-3"><Result result={disconnect.data} /></div>}
        {disconnect.error && <div className="mt-3"><Result result={{ ok: false, message: disconnect.error.message }} /></div>}
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
        {configured && <SignInStatus status={data.info.entraSignIn} onReconnect={() => setConnectOpen(true)} />}
        {!configured && data.info.httpsWarning && (
          <p className="mt-4 rounded-xl bg-warning/12 px-3.5 py-2.5 text-sm">
            Directory sync works over HTTP. <b>Sign in with Microsoft</b> switches on by itself once you open Trigon over HTTPS, because Microsoft rejects http:// redirect addresses other than localhost.
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
          <Field label="Redirect URI" hint="Leave empty and Trigon uses <address>/api/auth/entra/callback for every HTTPS address it is opened at, and registers them with Microsoft itself.">
            <TextInput value={form.redirectUri} onChange={(e) => set({ redirectUri: e.target.value.trim() })} placeholder={data.info.entraRedirectUri || 'https://trigon.example.com/api/auth/entra/callback'} />
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

      <ConnectSheet
        open={connectOpen}
        onOpenChange={setConnectOpen}
        onNext={() => setScopeOpen(true)}
        known={data.entra.signInOrigins ?? []}
        mailDefault={mailRequested || !!data.entra.mailSend}
        mailGranted={!!data.entra.mailSend}
      />
      <EntraScopeSheet
        open={scopeOpen}
        onOpenChange={setScopeOpen}
        initial={{ syncScope: data.entra.syncScope ?? 'all', syncGroups: data.entra.syncGroups ?? [], syncUsers: data.entra.syncUsers ?? [] }}
      />
    </div>
  );
}
