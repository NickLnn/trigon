'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { StorageLeftovers, StorageOverview } from '@trigon/shared';
import Link from 'next/link';
import { useState } from 'react';
import { Button, Result, SettingsCard } from '@/components/settings/ui';
import { DocIcon } from '@/components/ui/doc-icon';
import { api } from '@/lib/api';

const size = (b: number) =>
  b < 1024 ? `${b} B` : b < 1024 ** 2 ? `${(b / 1024).toFixed(0)} KB` : b < 1024 ** 3 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${(b / 1024 ** 3).toFixed(2)} GB`;

/** One labelled segment of the usage bar. */
const PARTS = [
  { key: 'files', label: 'Uploaded files', color: 'var(--accent)' },
  { key: 'images', label: 'Images in pages', color: '#00A86B' },
  { key: 'trash', label: 'In the trash', color: '#F5A623' },
  { key: 'backups', label: 'Backups', color: '#8E44EC' },
  { key: 'database', label: 'Database', color: '#00B5D8' },
] as const;

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-meta text-ink-3">{hint}</span>}
      </span>
      <span className="shrink-0 text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}

export default function StorageSettingsPage() {
  const qc = useQueryClient();
  const { data, error } = useQuery({ queryKey: ['storage-overview'], queryFn: () => api<StorageOverview>('/settings/storage') });
  const [confirmClean, setConfirmClean] = useState(false);
  const scan = useMutation({ mutationFn: () => api<StorageLeftovers>('/settings/storage/leftovers', { method: 'POST' }) });
  const clean = useMutation({
    mutationFn: () => api<StorageLeftovers & { removed: number }>('/settings/storage/leftovers/clean', { method: 'POST' }),
    onSuccess: () => {
      setConfirmClean(false);
      qc.invalidateQueries({ queryKey: ['storage-overview'] });
    },
  });

  if (error) return <Result result={{ ok: false, message: error.message }} />;
  if (!data) return <div className="h-40 animate-pulse rounded-card bg-surface" />;

  const used: Record<(typeof PARTS)[number]['key'], number> = {
    files: data.files.bytes,
    images: data.pageImages.bytes,
    trash: data.trash.bytes,
    backups: data.backups?.bytes ?? 0,
    database: data.database.bytes,
  };
  const parts = PARTS.filter((p) => p.key !== 'backups' || data.backups);
  const trigonTotal = Object.values(used).reduce((a, b) => a + b, 0);
  // The bar is the whole disk when known (Trigon's share vs the rest), otherwise just Trigon's parts.
  const scale = data.disk?.totalBytes || trigonTotal || 1;
  const leftover = scan.data;

  return (
    <div className="space-y-5">
      <SettingsCard
        title="Storage"
        description={
          data.storage.driver === 's3' ? (
            <>Files are kept in S3-compatible storage ({data.storage.location}).</>
          ) : (
            <>
              Files are kept on this server in <code className="rounded bg-surface-2 px-1">{data.storage.location}</code>.
            </>
          )
        }
      >
        <div className="flex h-3 overflow-hidden rounded-pill bg-surface-2" role="img" aria-label="Disk usage">
          {parts.map((p) => (
            <span key={p.key} style={{ width: `${(used[p.key] / scale) * 100}%`, background: p.color }} className="h-full min-w-0" />
          ))}
        </div>
        <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
          {parts.map((p) => (
            <li key={p.key} className="flex items-center gap-2 text-meta">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: p.color }} />
              <span className="text-ink-2">{p.label}</span>
              <span className="ml-auto font-semibold tabular-nums">{size(used[p.key])}</span>
            </li>
          ))}
        </ul>
        {data.disk && (
          <p className="mt-3 text-sm text-ink-2">
            Trigon uses <b className="text-ink">{size(trigonTotal)}</b>. The disk has <b className="text-ink">{size(data.disk.freeBytes)}</b> free of{' '}
            {size(data.disk.totalBytes)}.
            {data.disk.freeBytes / data.disk.totalBytes < 0.1 && <span className="font-semibold text-danger"> Less than 10% is free.</span>}
          </p>
        )}
      </SettingsCard>

      <SettingsCard title="Details">
        <div className="divide-y divide-line">
          <Row label="Uploaded files" hint={`${data.files.count.toLocaleString()} file${data.files.count === 1 ? '' : 's'}`} value={size(data.files.bytes)} />
          <Row label="Images in pages" hint={`${data.pageImages.count.toLocaleString()} pasted or clipped`} value={size(data.pageImages.bytes)} />
          <Row
            label="Database"
            hint={`Page text, settings and history — ${data.database.versions.toLocaleString()} saved version${data.database.versions === 1 ? '' : 's'} take${data.database.versions === 1 ? 's' : ''} about ${size(data.database.historyBytes)}`}
            value={size(data.database.bytes)}
          />
          {data.backups && <Row label="Backups on this server" hint={`${data.backups.count} in ${data.backups.location}`} value={size(data.backups.bytes)} />}
          <Row
            label="In the trash"
            hint={`${data.trash.items} item${data.trash.items === 1 ? '' : 's'} — removed for good after ${data.trash.purgeDays} days, or when someone empties a space’s trash`}
            value={size(data.trash.bytes)}
          />
        </div>
        {data.backups && (
          <p className="mt-2 text-meta text-ink-3">
            Backup space depends on how many are kept: <Link href="/settings/backups" className="font-semibold text-accent">Settings → Backups</Link>.
          </p>
        )}
      </SettingsCard>

      {data.largest.length > 0 && (
        <SettingsCard title="Largest files">
          <ul className="divide-y divide-line">
            {data.largest.map((f) => (
              <li key={f.id}>
                <Link href={`/d/${f.id}`} className="flex items-center gap-3 py-2 hover:text-accent">
                  <DocIcon kind="file" mimeType={f.mimeType} title={f.title} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{f.title}</span>
                    <span className="block truncate text-meta text-ink-3">{f.spaceName}</span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">{size(f.sizeBytes)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </SettingsCard>
      )}

      {data.spaces.length > 0 && (
        <SettingsCard title="By space" description="Uploaded files and images in pages.">
          <ul className="space-y-2.5">
            {data.spaces.map((s) => (
              <li key={s.id}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate font-medium">{s.name}</span>
                  <span className="shrink-0 tabular-nums text-ink-2">
                    {size(s.bytes)} · {s.files} file{s.files === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-pill bg-surface-2">
                  <div className="h-full rounded-pill bg-accent" style={{ width: `${(s.bytes / (data.spaces[0].bytes || 1)) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </SettingsCard>
      )}

      <SettingsCard
        title="Leftover files"
        description="Stored files that nothing in Trigon refers to any more — for example an upload that was interrupted. Only files older than a day are counted."
      >
        {leftover && (
          <p className="mb-3 text-sm">
            {leftover.count ? (
              <>
                Found <b>{leftover.count}</b> leftover file{leftover.count === 1 ? '' : 's'} using <b>{size(leftover.bytes)}</b>.
              </>
            ) : (
              'No leftover files — everything stored is in use.'
            )}
          </p>
        )}
        {clean.data && <Result result={{ ok: true, message: `Removed ${clean.data.removed} file${clean.data.removed === 1 ? '' : 's'} (${size(clean.data.bytes)}).` }} />}
        {(scan.error || clean.error) && <Result result={{ ok: false, message: (scan.error ?? clean.error)!.message }} />}
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="secondary" busy={scan.isPending} onClick={() => scan.mutate()}>
            {leftover ? 'Check again' : 'Check for leftover files'}
          </Button>
          {!!leftover?.count &&
            !clean.data &&
            (confirmClean ? (
              <>
                <Button variant="danger" busy={clean.isPending} onClick={() => clean.mutate()}>
                  Delete {leftover.count} file{leftover.count === 1 ? '' : 's'} for good
                </Button>
                <Button variant="secondary" onClick={() => setConfirmClean(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button variant="danger" onClick={() => setConfirmClean(true)}>
                Remove leftovers
              </Button>
            ))}
        </div>
      </SettingsCard>
    </div>
  );
}
