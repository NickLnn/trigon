'use client';

import type { SyncSourceStatus } from '@trigon/shared';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Result } from './ui';

/** Live sync progress ("Syncing… 0:42") and the outcome of the last run. */
export function SyncStatus({ status }: { status: SyncSourceStatus | undefined }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!status?.running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [status?.running]);
  if (!status) return null;

  if (status.running) {
    const secs = status.startedAt ? Math.max(0, Math.round((now - new Date(status.startedAt).getTime()) / 1000)) : 0;
    return (
      <p className="flex items-center gap-2 rounded-xl bg-accent-soft px-3.5 py-2.5 text-sm font-medium text-accent">
        <Loader2 className="size-4 animate-spin" /> Syncing in the background… {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')} — you can leave this page.
      </p>
    );
  }
  if (status.lastError) return <Result result={{ ok: false, message: `Last sync failed: ${status.lastError}` }} />;
  const r = status.lastResult;
  if (r) {
    return (
      <Result
        result={{
          ok: true,
          message: `Synced ${r.users} users, ${r.groups} groups and ${r.memberships} memberships in ${(r.durationMs / 1000).toFixed(1)}s${
            r.deactivated ? ` · ${r.deactivated} people no longer in scope were deactivated` : ''
          }.`,
        }}
      />
    );
  }
  return null;
}
