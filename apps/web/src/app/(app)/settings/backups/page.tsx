'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BackupDestination, BackupFile, BackupOverview, BackupSettings } from '@trigon/shared';
import { Check, Copy, Download, HardDrive, Loader2, Network, RotateCcw, Server, ShieldCheck, Trash2 } from 'lucide-react';
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

const DESTINATIONS: { value: BackupDestination; label: string; hint: string; icon: ReactNode }[] = [
  { value: 'local', label: 'This server', hint: 'A folder next to Trigon on the NAS (data/backups). No setup.', icon: <HardDrive className="size-5" /> },
  { value: 'smb', label: 'SMB share', hint: 'A Windows / Synology / NAS share. Trigon connects with a user and password.', icon: <Network className="size-5" /> },
  { value: 'nfs', label: 'NFS share', hint: 'An NFS export, attached once in docker-compose.yml.', icon: <Server className="size-5" /> },
];

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
      setForm({ ...data.settings, smbPassword: '' });
      setCustom(!PRESETS.some((p) => p.cron === data.settings.schedule));
    }
  }, [data, form]);

  const payload = () => {
    const { hasSmbPassword: _h, lastRun: _l, ...rest } = form!;
    return rest;
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
  const savedDestination = data.settings.destination === form.destination;

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
          <p className={data.destination.ok && data.destination.persistent !== false ? 'text-ink-2' : 'text-danger'}>
            <b className="text-ink">Destination:</b> {data.destination.message}
            {data.destination.freeBytes != null && ` · ${size(data.destination.freeBytes)} free`}
          </p>
        </div>
        {data.running ? (
          <p className="mt-4 flex items-center gap-2 rounded-xl bg-accent-soft/60 px-3.5 py-2.5 text-sm font-semibold text-accent">
            <Loader2 className="size-4 animate-spin" /> {data.running.kind === 'restore' ? 'Restoring' : 'Backing up'}: {data.running.step}…
          </p>
        ) : (
          <div className="mt-4">
            <Button onClick={() => runNow.mutate()} busy={runNow.isPending} disabled={!data.destination.ok}>
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

        <SettingsCard title="Where">
          <div className="grid gap-2 sm:grid-cols-3">
            {DESTINATIONS.map((d) => (
              <button
                key={d.value}
                type="button"
                onClick={() => set({ destination: d.value })}
                aria-pressed={form.destination === d.value}
                className={`press rounded-2xl p-3.5 text-left ring-2 ${form.destination === d.value ? 'bg-accent-soft/50 ring-accent' : 'bg-surface-2/60 ring-transparent hover:bg-surface-2'}`}
              >
                <span className={`grid size-10 place-items-center rounded-xl ${form.destination === d.value ? 'bg-accent text-accent-ink' : 'bg-surface-3 text-ink-2'}`}>{d.icon}</span>
                <span className={`mt-3 block font-semibold ${form.destination === d.value ? 'text-accent' : ''}`}>{d.label}</span>
                <span className="mt-1 block text-meta text-ink-3">{d.hint}</span>
              </button>
            ))}
          </div>

          <div className="mt-5 space-y-4">
            {form.destination === 'local' && (
              <>
                <Field label="Folder" hint="Inside the container. /data/backups is the data/backups folder next to docker-compose.yml on the NAS.">
                  <TextInput value={form.localPath} onChange={(e) => set({ localPath: e.target.value.trim() })} className="font-mono" placeholder="/data/backups" />
                </Field>
                <p className="rounded-xl bg-warning/12 px-3.5 py-2.5 text-sm">
                  A backup on the same NAS protects against mistakes, not against the NAS failing. For that, also copy data/backups elsewhere (e.g. Hyper Backup) — or use SMB / NFS to another device.
                </p>
              </>
            )}

            {form.destination === 'smb' && (
              <>
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

            {form.destination === 'nfs' && (
              <>
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

      <SettingsCard title="Backups" description={savedDestination ? `At ${data.destination.ok ? data.destination.message.replace(/^Connected: /, '') : 'the destination'}, newest first.` : 'Save the new destination to see its backups.'}>
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
