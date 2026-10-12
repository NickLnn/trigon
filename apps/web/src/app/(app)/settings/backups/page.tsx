'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BackupDestination, BackupFile, BackupOverview, BackupSettings, GdriveConnectStatus } from '@trigon/shared';
import { Check, CircleCheck, Copy, Download, ExternalLink, HardDrive, Loader2, Network, RotateCcw, Server, ShieldCheck, Trash2, Unplug } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Badge, Button, Field, Result, SettingsCard, TextInput, Toggle } from '@/components/settings/ui';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { relativeTime } from '@/components/ui/doc-icon';
import { api } from '@/lib/api';

const PRESETS = [
  { cron: '0 2 * * *', label: 'Every night at 02:00' },
  { cron: '0 */6 * * *', label: 'Every 6 hours' },
  { cron: '0 2 * * 0', label: 'Every Sunday at 02:00' },
];
const KEEP = [3, 7, 14, 30, 60, 90];

function GoogleDriveLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 87.3 78" className={className} aria-hidden>
      <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da" />
      <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47" />
      <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335" />
      <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d" />
      <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc" />
      <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00" />
    </svg>
  );
}

const DESTINATIONS: { value: BackupDestination; label: string; hint: string; icon: ReactNode }[] = [
  { value: 'local', label: 'This server', hint: 'A folder next to Trigon on the NAS (data/backups). No setup.', icon: <HardDrive className="size-5" /> },
  { value: 'smb', label: 'SMB share', hint: 'A Windows / Synology / NAS share. Trigon connects with a user and password.', icon: <Network className="size-5" /> },
  { value: 'nfs', label: 'NFS share', hint: 'An NFS export, attached once in docker-compose.yml.', icon: <Server className="size-5" /> },
  { value: 'gdrive', label: 'Google Drive', hint: 'Off-site copy in your Google Drive. Trigon only sees its own folder.', icon: <GoogleDriveLogo className="size-5" /> },
];
const DEST_NAME: Record<BackupDestination, string> = { local: 'This server', smb: 'SMB', nfs: 'NFS', gdrive: 'Google Drive' };

const size = (b: number | null | undefined) =>
  b == null ? '—' : b < 1024 ** 2 ? `${(b / 1024).toFixed(0)} KB` : b < 1024 ** 3 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${(b / 1024 ** 3).toFixed(2)} GB`;
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const TRIGGER: Record<BackupFile['trigger'], { label: string; tone: 'neutral' | 'accent' | 'warning' }> = {
  scheduled: { label: 'Scheduled', tone: 'neutral' },
  manual: { label: 'Manual', tone: 'accent' },
  'before-restore': { label: 'Before a restore', tone: 'warning' },
};

function CopyBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-xl bg-surface-2 p-3.5 pr-11 font-mono text-meta leading-relaxed">{text}</pre>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="absolute right-2 top-2 grid size-7 place-items-center rounded-lg text-ink-3 hover:bg-surface-3"
        aria-label="Copy"
      >
        {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}

/** "Connect Google Drive": set-up steps with direct links, then a code to enter at google.com/device. */
function GoogleConnectSheet({ open, onOpenChange, stored, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; stored: BackupSettings; onDone: () => void }) {
  const [clientId, setClientId] = useState(stored.gdriveClientId);
  const [clientSecret, setClientSecret] = useState('');
  const [copied, setCopied] = useState(false);
  const [started, setStarted] = useState(false);
  const status = useQuery({
    queryKey: ['gdrive-connect'],
    queryFn: () => api<GdriveConnectStatus>('/backups/gdrive/connect'),
    enabled: open && started,
    refetchInterval: (q) => (q.state.data?.state === 'waiting_for_sign_in' || q.state.data?.state === 'working' ? 2000 : false),
  });
  const qc = useQueryClient();
  const start = useMutation({
    mutationFn: () => api<GdriveConnectStatus>('/backups/gdrive/connect', { method: 'POST', json: { clientId, clientSecret: clientSecret || undefined } }),
    onSuccess: (s) => {
      qc.setQueryData(['gdrive-connect'], s);
      setStarted(true);
    },
  });
  const s = started ? status.data : undefined;
  useEffect(() => {
    if (s?.state === 'done') onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s?.state]);
  useEffect(() => {
    if (!open) return;
    setStarted(false);
    start.reset();
    setClientId(stored.gdriveClientId);
    setClientSecret('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const active = s?.state === 'waiting_for_sign_in' || s?.state === 'working';
  const canStart = !!clientId.trim() && (!!clientSecret.trim() || !!stored.hasGdriveClientSecret);
  const link = (href: string, text: string) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-accent">
      {text} <ExternalLink className="size-3" />
    </a>
  );

  const header = (
    <div className="mb-4 flex items-center gap-3 rounded-2xl bg-surface-2/60 p-3">
      <span className="grid size-11 place-items-center rounded-xl bg-white shadow-sm ring-1 ring-line">
        <GoogleDriveLogo className="size-6" />
      </span>
      <span className="text-sm text-ink-2">
        Trigon stores backups in <b className="text-ink">one folder of your Google Drive</b>, created for you. With Google&apos;s <b className="text-ink">drive.file</b> permission it can never see the rest of your Drive.
      </span>
    </div>
  );

  if (!s || s.state === 'idle') {
    return (
      <BottomSheet open={open} onOpenChange={onOpenChange} title="Connect Google Drive" description="One-time set-up in Google Cloud (about 5 minutes), then sign in with a code.">
        {header}
        <ol className="space-y-3 text-sm text-ink-2">
          <li className="flex gap-3">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-meta font-bold text-accent">1</span>
            <span>
              {link('https://console.cloud.google.com/projectcreate', 'Create a Google Cloud project')} named e.g. <b className="text-ink">Trigon</b> (free).
            </span>
          </li>
          <li className="flex gap-3">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-meta font-bold text-accent">2</span>
            <span>
              {link('https://console.cloud.google.com/apis/library/drive.googleapis.com', 'Enable the Google Drive API')} for that project.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-meta font-bold text-accent">3</span>
            <span>
              {link('https://console.cloud.google.com/auth/overview', 'Google Auth Platform')} → <b className="text-ink">Get started</b>: app name <b className="text-ink">Trigon</b>, your email, audience <b className="text-ink">External</b>. Then under{' '}
              <b className="text-ink">Audience</b> press <b className="text-ink">Publish app</b> — otherwise Google disconnects Trigon after 7 days. No Google review is needed for this permission.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-meta font-bold text-accent">4</span>
            <span>
              {link('https://console.cloud.google.com/auth/clients/create', 'Create an OAuth client')} with application type <b className="text-ink">TVs and Limited Input devices</b>, name <b className="text-ink">Trigon</b>. Copy the
              client ID and secret here:
            </span>
          </li>
        </ol>
        <div className="mt-4 space-y-3">
          <Field label="Client ID">
            <TextInput value={clientId} onChange={(e) => setClientId(e.target.value.trim())} placeholder="1234-abc.apps.googleusercontent.com" autoCapitalize="none" />
          </Field>
          <Field label="Client secret" hint={stored.hasGdriveClientSecret ? 'A secret is stored. Leave empty to keep it.' : 'Stored encrypted.'}>
            <TextInput type="password" autoComplete="new-password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value.trim())} placeholder={stored.hasGdriveClientSecret ? '••••••••' : 'GOCSPX-…'} />
          </Field>
          {start.error && <Result result={{ ok: false, message: start.error.message }} />}
          <Button className="w-full" disabled={!canStart} busy={start.isPending} onClick={() => start.mutate()}>
            <GoogleDriveLogo className="size-4" /> Continue — sign in with Google
          </Button>
        </div>
      </BottomSheet>
    );
  }

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title="Connect Google Drive" description="Sign in with the Google account whose Drive should hold the backups.">
      {header}
      {s.state === 'waiting_for_sign_in' && s.userCode && (
        <div className="rounded-2xl bg-surface-2 p-5 text-center">
          <p className="text-sm text-ink-2">1. Open Google&apos;s device sign-in page</p>
          <a
            href={s.verificationUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="press mt-2 inline-flex items-center gap-2 rounded-pill bg-accent px-5 py-2.5 font-semibold text-accent-ink"
          >
            {(s.verificationUrl ?? 'google.com/device').replace(/^https?:\/\/(www\.)?/, '')} <ExternalLink className="size-4" />
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
          <p className="mt-5 text-meta text-ink-3">3. Choose your Google account and allow access. If Google says the app isn&apos;t verified, choose Advanced → Go to Trigon — it&apos;s your own app. This page continues by itself.</p>
        </div>
      )}
      <ol className="mt-5 space-y-2.5">
        {s.steps.map((step, i) => {
          const running = !step.done && (i === 0 || s.steps[i - 1].done) && active;
          return (
            <li key={step.label} className="flex items-center gap-3 text-sm">
              <span className={`grid size-6 shrink-0 place-items-center rounded-full ${step.done ? 'bg-success text-white' : running ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-ink-3'}`}>
                {step.done ? <Check className="size-3.5" /> : running ? <Loader2 className="size-3.5 animate-spin" /> : i + 1}
              </span>
              <span className={step.done ? '' : 'text-ink-2'}>{step.label}</span>
            </li>
          );
        })}
      </ol>
      {s.state === 'done' && (
        <div className="mt-5 space-y-3">
          <Result result={{ ok: true, message: s.message ?? 'Connected.' }} />
          <Button className="w-full" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      )}
      {s.state === 'error' && (
        <div className="mt-5 space-y-3">
          <Result result={{ ok: false, message: s.message ?? 'Something went wrong' }} />
          <Button onClick={() => setStarted(false)}>Try again</Button>
        </div>
      )}
    </BottomSheet>
  );
}

/** Google Drive in the "Where" card: connected state, or the button that opens the connect pop-up. */
function GoogleDriveSection({
  form,
  set,
  stored,
  onChanged,
}: {
  form: BackupSettings;
  set: (p: Partial<BackupSettings>) => void;
  stored: BackupSettings;
  onChanged: (fresh?: BackupOverview) => void;
}) {
  const [open, setOpen] = useState(false);
  const connected = !!stored.hasGdriveRefreshToken && !!stored.gdriveFolderId;
  const disconnect = useMutation({ mutationFn: () => api<BackupOverview>('/backups/gdrive/disconnect', { method: 'POST' }), onSuccess: (fresh) => onChanged(fresh) });

  return (
    <>
      <h3 className="flex items-center gap-2 pt-2 text-sm font-bold">
        <GoogleDriveLogo className="size-4" /> Google Drive
      </h3>
      {connected ? (
        <>
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-success/10 px-4 py-3 text-sm">
            <CircleCheck className="size-5 shrink-0 text-success" />
            <span className="min-w-0 flex-1">
              Connected{stored.gdriveAccount ? ` as ${stored.gdriveAccount}` : ''}. Backups go to <b>My Drive › {stored.gdriveFolderName}</b>.
            </span>
            <a href={`https://drive.google.com/drive/folders/${stored.gdriveFolderId}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-accent">
              Open folder <ExternalLink className="size-3.5" />
            </a>
            <button type="button" onClick={() => disconnect.mutate()} className="inline-flex items-center gap-1 font-semibold text-ink-3 hover:text-danger">
              <Unplug className="size-3.5" /> Disconnect
            </button>
          </div>
          <Field label="Folder in My Drive" hint="Created automatically. Change the name and save to put new backups in another folder.">
            <TextInput value={form.gdriveFolderName} onChange={(e) => set({ gdriveFolderName: e.target.value })} placeholder="Trigon Backups" />
          </Field>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-2/60 px-4 py-3 text-sm">
          <span className="min-w-0 flex-1 text-ink-2">Not connected yet. A short one-time set-up, then sign in with a code — the backup folder is created for you.</span>
          <Button type="button" onClick={() => setOpen(true)}>
            <GoogleDriveLogo className="size-4" /> Connect Google Drive
          </Button>
        </div>
      )}
      {disconnect.error && <Result result={{ ok: false, message: disconnect.error.message }} />}
      <GoogleConnectSheet open={open} onOpenChange={setOpen} stored={stored} onDone={() => onChanged()} />
    </>
  );
}

/** Waits for the API to come back after a restore, then reloads the app. */
function RestartWatcher() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    let wentDown = false;
    const timer = setInterval(async () => {
      setSeconds(Math.round((Date.now() - started) / 1000));
      const up = await fetch('/api/health', { cache: 'no-store' }).then((r) => r.ok).catch(() => false);
      if (!up) wentDown = true;
      if (up && (wentDown || Date.now() - started > 20_000)) {
        clearInterval(timer);
        window.location.href = '/login';
      }
    }, 1500);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-6">
      <div className="max-w-sm rounded-card bg-surface p-6 text-center shadow-card">
        <Loader2 className="mx-auto size-8 animate-spin text-accent" />
        <p className="mt-3 font-semibold">Restored. Trigon is restarting…</p>
        <p className="mt-1 text-sm text-ink-2">You will be asked to sign in again. ({seconds}s)</p>
      </div>
    </div>
  );
}

function RestoreSheet({ file, onClose, onRestarting }: { file: BackupFile; onClose: () => void; onRestarting: () => void }) {
  const [typed, setTyped] = useState('');
  const restore = useMutation({
    mutationFn: () => api(`/backups/files/${encodeURIComponent(file.name)}/restore`, { method: 'POST', json: { confirm: file.name } }),
    onSuccess: onRestarting,
  });
  return (
    <BottomSheet open onOpenChange={(v) => !v && !restore.isPending && onClose()} title="Restore this backup?" description={when(file.createdAt)}>
      <div className="space-y-4">
        <ul className="space-y-2 text-sm text-ink-2">
          <li className="flex gap-2">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" /> First Trigon takes a safety backup of everything as it is now, so you can come back.
          </li>
          <li className="flex gap-2">
            <RotateCcw className="mt-0.5 size-4 shrink-0 text-accent" /> Then every space, page, file, user and setting goes back to how it was on {when(file.createdAt)}. Changes made since are replaced.
          </li>
          <li className="flex gap-2">
            <Loader2 className="mt-0.5 size-4 shrink-0 text-ink-3" /> Trigon restarts and everyone signs in again. Backup settings stay as they are now.
          </li>
        </ul>
        <Field label='Type RESTORE to confirm'>
          <TextInput value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="RESTORE" autoCapitalize="characters" />
        </Field>
        {restore.error && <Result result={{ ok: false, message: restore.error.message }} />}
        <Button className="w-full" variant="danger" disabled={typed.trim().toUpperCase() !== 'RESTORE'} busy={restore.isPending} onClick={() => restore.mutate()}>
          {restore.isPending ? 'Restoring — this can take a few minutes…' : 'Restore this backup'}
        </Button>
      </div>
    </BottomSheet>
  );
}

export default function BackupsSettingsPage() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['backups'],
    queryFn: () => api<BackupOverview>('/backups'),
    refetchInterval: (q) => (q.state.data?.running ? 2000 : 30_000),
  });
  const [form, setForm] = useState<BackupSettings | null>(null);
  const [custom, setCustom] = useState(false);
  const [restoring, setRestoring] = useState<BackupFile | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    if (data && !form) {
      setForm({ ...data.settings, smbPassword: '', gdriveClientSecret: '' });
      setCustom(!PRESETS.some((p) => p.cron === data.settings.schedule));
    }
  }, [data, form]);

  const payload = () => {
    // Only what the form edits — read-only and old fields (like the former single `destination`) stay out.
    const f = form!;
    return {
      enabled: f.enabled,
      schedule: f.schedule,
      keep: f.keep,
      destinations: f.destinations,
      localPath: f.localPath,
      nfsServer: f.nfsServer,
      nfsExport: f.nfsExport,
      smbHost: f.smbHost,
      smbShare: f.smbShare,
      smbPath: f.smbPath,
      smbUser: f.smbUser,
      smbDomain: f.smbDomain,
      smbPassword: f.smbPassword,
      gdriveClientId: f.gdriveClientId,
      gdriveClientSecret: f.gdriveClientSecret,
      gdriveFolderName: f.gdriveFolderName,
    };
  };
  const save = useMutation({
    mutationFn: () => api<BackupOverview>('/backups/settings', { method: 'PUT', json: payload() }),
    onSuccess: (fresh) => qc.setQueryData(['backups'], fresh),
  });
  const test = useMutation({ mutationFn: () => api<{ ok: boolean; message: string }>('/backups/test', { method: 'POST', json: payload() }) });
  const runNow = useMutation({ mutationFn: () => api('/backups/run', { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['backups'] }) });
  const remove = useMutation({
    mutationFn: (name: string) => api(`/backups/files/${encodeURIComponent(name)}`, { method: 'DELETE' }),
    onSuccess: () => {
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ['backups'] });
    },
  });

  if (!data || !form) return <div className="h-60 animate-pulse rounded-card bg-surface" />;
  const set = (patch: Partial<BackupSettings>) => {
    setForm((f) => ({ ...f!, ...patch }));
    test.reset();
    save.reset();
  };
  const last = data.settings.lastRun;
  const savedDestinations = [...data.settings.destinations].sort().join() === [...form.destinations].sort().join();

  return (
    <div className="space-y-5">
      {restarting && <RestartWatcher />}

      <SettingsCard
        title="Status"
        actions={last ? <Badge tone={last.ok ? 'success' : 'danger'}>{last.ok ? 'Last backup OK' : 'Last backup failed'}</Badge> : <Badge>No backup yet</Badge>}
      >
        <div className="space-y-1 text-sm">
          {last && (
            <p>
              <b>Last:</b> {when(last.at)} ({relativeTime(last.at)}) · {last.ok ? size(last.sizeBytes) : last.message}
            </p>
          )}
          <p>
            <b>Next:</b> {data.settings.enabled && data.nextRun ? `${when(data.nextRun)}` : 'not scheduled'}
          </p>
          {data.destinations.map((d) => (
            <p key={d.key} className={d.ok ? 'text-ink-2' : 'text-danger'}>
              <b className="text-ink">{DEST_NAME[d.key]}:</b> {d.message}
              {d.freeBytes != null && ` · ${size(d.freeBytes)} free`}
            </p>
          ))}
        </div>
        {data.running ? (
          <p className="mt-4 flex items-center gap-2 rounded-xl bg-accent-soft/60 px-3.5 py-2.5 text-sm font-semibold text-accent">
            <Loader2 className="size-4 animate-spin" /> {data.running.kind === 'restore' ? 'Restoring' : 'Backing up'}: {data.running.step}…
          </p>
        ) : (
          <div className="mt-4">
            <Button onClick={() => runNow.mutate()} busy={runNow.isPending} disabled={!data.destinations.some((d) => d.ok)}>
              <HardDrive className="size-4" /> Back up now
            </Button>
          </div>
        )}
        {runNow.error && <div className="mt-3"><Result result={{ ok: false, message: runNow.error.message }} /></div>}
        <p className="mt-3 text-meta text-ink-3">A backup is one file with the whole database (spaces, pages, history, users, settings) and every uploaded file and image.</p>
      </SettingsCard>

      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <SettingsCard title="When">
          <div className="space-y-4">
            <Toggle label="Back up automatically" hint="Times are the server's clock (usually UTC in Docker)." checked={form.enabled} onChange={(v) => set({ enabled: v })} />
            {form.enabled && (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {PRESETS.map((p) => (
                    <button
                      key={p.cron}
                      type="button"
                      onClick={() => {
                        setCustom(false);
                        set({ schedule: p.cron });
                      }}
                      className={`press rounded-pill px-3.5 py-1.5 text-sm font-semibold ${!custom && form.schedule === p.cron ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-ink-2 hover:bg-surface-3'}`}
                    >
                      {p.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setCustom(true)}
                    className={`press rounded-pill px-3.5 py-1.5 text-sm font-semibold ${custom ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-ink-2 hover:bg-surface-3'}`}
                  >
                    Custom…
                  </button>
                </div>
                {custom && (
                  <Field label="Schedule (cron)" hint="minute hour day month weekday — e.g. 30 1 * * 1-5 = 01:30 on weekdays.">
                    <TextInput value={form.schedule} onChange={(e) => set({ schedule: e.target.value })} className="font-mono" placeholder="0 2 * * *" />
                  </Field>
                )}
              </>
            )}
            <Field label="Keep" hint="Older backups at the destination are deleted after each new one.">
              <select
                value={form.keep}
                onChange={(e) => set({ keep: Number(e.target.value) })}
                className="w-full rounded-xl bg-surface-2 px-3.5 py-2.5 outline-none ring-accent focus:ring-2 sm:w-60"
              >
                {[...new Set([...KEEP, form.keep])].sort((a, b) => a - b).map((k) => (
                  <option key={k} value={k}>
                    The last {k} backups
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </SettingsCard>

        <SettingsCard title="Where" description="Pick one or more. Each backup is copied to every place you choose — e.g. the NAS for quick restores and Google Drive off-site.">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {DESTINATIONS.map((d) => {
              const on = form.destinations.includes(d.value);
              return (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => {
                    const next = on ? form.destinations.filter((x) => x !== d.value) : [...form.destinations, d.value];
                    if (next.length) set({ destinations: next });
                  }}
                  aria-pressed={on}
                  className={`press relative rounded-2xl p-3.5 text-left ring-2 ${on ? 'bg-accent-soft/50 ring-accent' : 'bg-surface-2/60 ring-transparent hover:bg-surface-2'}`}
                >
                  {on && <CircleCheck className="absolute right-3 top-3 size-5 text-accent" />}
                  <span className={`grid size-10 place-items-center rounded-xl ${d.value === 'gdrive' ? 'bg-white ring-1 ring-line' : on ? 'bg-accent text-accent-ink' : 'bg-surface-3 text-ink-2'}`}>{d.icon}</span>
                  <span className={`mt-3 block font-semibold ${on ? 'text-accent' : ''}`}>{d.label}</span>
                  <span className="mt-1 block text-meta text-ink-3">{d.hint}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-5 space-y-4">
            {form.destinations.includes('local') && (
              <h3 className="pt-2 text-sm font-bold">This server</h3>
            )}
            {form.destinations.includes('local') && (
              <>
                <Field label="Folder" hint="Inside the container. /data/backups is the data/backups folder next to docker-compose.yml on the NAS.">
                  <TextInput value={form.localPath} onChange={(e) => set({ localPath: e.target.value.trim() })} className="font-mono" placeholder="/data/backups" />
                </Field>
                <p className="rounded-xl bg-warning/12 px-3.5 py-2.5 text-sm">
                  A backup on the same NAS protects against mistakes, not against the NAS failing. For that, also copy data/backups elsewhere (e.g. Hyper Backup) — or use SMB / NFS to another device.
                </p>
              </>
            )}

            {form.destinations.includes('smb') && (
              <>
                <h3 className="pt-2 text-sm font-bold">SMB share</h3>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Server" hint="Name or IP address, e.g. nas.local">
                    <TextInput value={form.smbHost} onChange={(e) => set({ smbHost: e.target.value.trim() })} placeholder="nas.local" autoCapitalize="none" />
                  </Field>
                  <Field label="Share">
                    <TextInput value={form.smbShare} onChange={(e) => set({ smbShare: e.target.value.trim() })} placeholder="backup" autoCapitalize="none" />
                  </Field>
                </div>
                <Field label="Folder in the share" hint="Created if it doesn't exist.">
                  <TextInput value={form.smbPath} onChange={(e) => set({ smbPath: e.target.value.trim() })} placeholder="trigon-backups" autoCapitalize="none" />
                </Field>
                <div className="grid gap-4 md:grid-cols-3">
                  <Field label="User">
                    <TextInput value={form.smbUser} onChange={(e) => set({ smbUser: e.target.value })} autoComplete="off" autoCapitalize="none" />
                  </Field>
                  <Field label="Password" hint={data.settings.hasSmbPassword ? 'Stored. Leave empty to keep it.' : undefined}>
                    <TextInput type="password" autoComplete="new-password" value={form.smbPassword ?? ''} onChange={(e) => set({ smbPassword: e.target.value })} placeholder={data.settings.hasSmbPassword ? '••••••••' : ''} />
                  </Field>
                  <Field label="Domain (optional)">
                    <TextInput value={form.smbDomain} onChange={(e) => set({ smbDomain: e.target.value })} placeholder="WORKGROUP" autoCapitalize="none" />
                  </Field>
                </div>
                <p className="text-meta text-ink-3">Use an account that can only write to this share. The password is stored encrypted.</p>
              </>
            )}

            {form.destinations.includes('nfs') && (
              <>
                <h3 className="pt-2 text-sm font-bold">NFS share</h3>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="NFS server">
                    <TextInput value={form.nfsServer} onChange={(e) => set({ nfsServer: e.target.value.trim() })} placeholder="nas.local" autoCapitalize="none" />
                  </Field>
                  <Field label="Export path">
                    <TextInput value={form.nfsExport} onChange={(e) => set({ nfsExport: e.target.value.trim() })} placeholder="/volume1/backups/trigon" autoCapitalize="none" />
                  </Field>
                </div>
                <div className="rounded-xl bg-surface-2/60 p-4 text-sm">
                  <p className="font-semibold">Attach it once</p>
                  <p className="mt-1 text-ink-2">
                    A container can&apos;t mount NFS by itself without full system rights, so Docker mounts it. Save, then add these lines to docker-compose.yml on the NAS and run <code className="rounded bg-surface px-1">docker compose up -d</code>. Trigon then writes to /data/backups-nfs.
                  </p>
                  <div className="mt-3">
                    <CopyBlock text={data.nfsCompose} />
                  </div>
                  <p className="mt-2 text-meta text-ink-3">The export must allow writes from this NAS (Synology: Shared folder → NFS permissions → Read/Write, Squash: map all users to admin).</p>
                </div>
              </>
            )}

            {form.destinations.includes('gdrive') && (
              <GoogleDriveSection
                form={form}
                set={set}
                stored={data.settings}
                onChanged={(fresh) => {
                  if (fresh) qc.setQueryData(['backups'], fresh);
                  else qc.invalidateQueries({ queryKey: ['backups'] });
                  setForm(null);
                }}
              />
            )}
          </div>

          <div className="mt-5 space-y-3">
            <Result result={test.data} />
            {test.error && <Result result={{ ok: false, message: test.error.message }} />}
            {save.error && <Result result={{ ok: false, message: save.error.message }} />}
            {save.isSuccess && <Result result={{ ok: true, message: 'Saved.' }} />}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" busy={save.isPending}>
                Save
              </Button>
              <Button type="button" variant="secondary" busy={test.isPending} onClick={() => test.mutate()}>
                Test destination
              </Button>
            </div>
          </div>
        </SettingsCard>
      </form>

      <SettingsCard title="Backups" description={savedDestinations ? 'Newest first, from every destination.' : 'Save your changes to see the backups at the new destinations.'}>
        {data.files.length === 0 ? (
          <p className="text-sm text-ink-3">No backups here yet.</p>
        ) : (
          <ul className="overflow-hidden rounded-2xl border border-line">
            {data.files.map((f, i) => (
              <li key={f.name} className={`px-4 py-3 ${i ? 'border-t border-line' : ''}`}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{when(f.createdAt)}</span>
                    <span className="block truncate text-meta text-ink-3">
                      {relativeTime(f.createdAt)} · {size(f.sizeBytes)} · {f.name}
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-1">
                    {f.locations.map((l) => (
                      <Badge key={l}>{DEST_NAME[l]}</Badge>
                    ))}
                  </span>
                  <Badge tone={TRIGGER[f.trigger].tone}>{TRIGGER[f.trigger].label}</Badge>
                  <div className="flex gap-1">
                    <a href={`/api/backups/files/${encodeURIComponent(f.name)}`} className="press grid size-9 place-items-center rounded-full text-ink-2 hover:bg-surface-2" aria-label="Download" title="Download">
                      <Download className="size-4" />
                    </a>
                    <button onClick={() => setRestoring(f)} disabled={!!data.running} className="press grid size-9 place-items-center rounded-full text-ink-2 hover:bg-surface-2 disabled:opacity-40" aria-label="Restore" title="Restore">
                      <RotateCcw className="size-4" />
                    </button>
                    <button onClick={() => setDeleting(f.name)} className="press grid size-9 place-items-center rounded-full text-ink-3 hover:bg-danger/10 hover:text-danger" aria-label="Delete" title="Delete">
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
                {deleting === f.name && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-danger/10 p-3 text-sm">
                    <span className="flex-1">Delete this backup for good?</span>
                    <Button type="button" variant="danger" busy={remove.isPending} onClick={() => remove.mutate(f.name)}>
                      Delete
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => setDeleting(null)}>
                      Cancel
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {remove.error && <div className="mt-3"><Result result={{ ok: false, message: remove.error.message }} /></div>}
      </SettingsCard>

      {restoring && (
        <RestoreSheet
          file={restoring}
          onClose={() => setRestoring(null)}
          onRestarting={() => {
            setRestoring(null);
            setRestarting(true);
          }}
        />
      )}
    </div>
  );
}
