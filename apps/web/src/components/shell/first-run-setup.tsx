'use client';

import { Globe } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AddressFields, useCurrentAddress } from '@/components/settings/address-fields';
import { Button, Result } from '@/components/settings/ui';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { useSaveSettings, useSettings } from '@/lib/admin-queries';

/**
 * First-run step for administrators: "Where does Trigon live?" — the internal and public addresses,
 * pre-filled from the address the browser is on. Shown once; Skip is always possible, and both can be
 * changed later in Settings → General.
 */
export function FirstRunSetup() {
  const { data } = useSettings();
  const save = useSaveSettings('general');
  const here = useCurrentAddress();
  const [open, setOpen] = useState(false);
  const [urls, setUrls] = useState({ internalUrl: '', publicUrl: '' });

  useEffect(() => {
    if (!data || !here || data.general.setupDone) return;
    setUrls({
      internalUrl: data.general.internalUrl || (here.isPublic ? data.info.internalUrl : here.origin),
      publicUrl: data.general.publicUrl || (here.isPublic ? here.origin : (data.info.publicUrl ?? '')),
    });
    setOpen(true);
  }, [data, here]);

  if (!data || data.general.setupDone) return null;
  const finish = (withAddresses: boolean) => save.mutate(withAddresses ? { ...urls, setupDone: true } : { setupDone: true }, { onSuccess: () => setOpen(false) });

  return (
    <BottomSheet open={open} onOpenChange={(v) => !v && finish(false)} title="Where does Trigon live?" description="Two addresses, so links in emails and Microsoft sign-in point to the right place.">
      <div className="space-y-5">
        <div className="flex items-center gap-3 rounded-2xl bg-surface-2/60 p-3 text-sm text-ink-2">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
            <Globe className="size-5" />
          </span>
          You&apos;re on <b className="text-ink">{here?.origin}</b> right now. We filled in what we could — check it and save, or skip and set it later in Settings → General.
        </div>
        <AddressFields internalUrl={urls.internalUrl} publicUrl={urls.publicUrl} onChange={(p) => setUrls((u) => ({ ...u, ...p }))} />
        {save.error && <Result result={{ ok: false, message: save.error.message }} />}
        <div className="flex flex-wrap gap-2">
          <Button busy={save.isPending} onClick={() => finish(true)}>
            Save
          </Button>
          <Button variant="secondary" disabled={save.isPending} onClick={() => finish(false)}>
            Skip for now
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
