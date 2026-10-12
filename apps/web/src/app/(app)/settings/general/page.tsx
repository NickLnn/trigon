'use client';

import { AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AddressFields } from '@/components/settings/address-fields';
import { Button, Result, SettingsCard, Toggle } from '@/components/settings/ui';
import { useSaveSettings, useSettings } from '@/lib/admin-queries';

export default function GeneralSettingsPage() {
  const { data } = useSettings();
  const save = useSaveSettings('general');
  const saveAddresses = useSaveSettings('general');
  const [urls, setUrls] = useState<{ internalUrl: string; publicUrl: string } | null>(null);

  useEffect(() => {
    if (data) setUrls({ internalUrl: data.general.internalUrl || data.info.internalUrl, publicUrl: data.general.publicUrl || data.info.publicUrl || '' });
  }, [data]);

  if (!data || !urls) return <div className="h-40 animate-pulse rounded-card bg-surface" />;

  return (
    <div className="space-y-5">
      {data.info.httpsWarning && (
        <div className="flex gap-3 rounded-card bg-warning/12 p-4 text-sm">
          <AlertTriangle className="size-5 shrink-0 text-warning" />
          <p>
            No public HTTPS address is set. Install-to-home-screen, offline mode and Microsoft sign-in need HTTPS — put a reverse proxy or Cloudflare Tunnel with a
            certificate in front of Trigon, then enter that address under <b>Addresses</b>.
          </p>
        </div>
      )}

      <SettingsCard title="Addresses" description="Where Trigon lives. Links in emails and Microsoft sign-in use the public address.">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            saveAddresses.mutate({ ...urls, setupDone: true });
          }}
        >
          <AddressFields internalUrl={urls.internalUrl} publicUrl={urls.publicUrl} onChange={(p) => setUrls((u) => ({ ...u!, ...p }))} />
          {saveAddresses.error && <Result result={{ ok: false, message: saveAddresses.error.message }} />}
          {saveAddresses.isSuccess && <Result result={{ ok: true, message: 'Saved.' }} />}
          <Button type="submit" busy={saveAddresses.isPending}>
            Save
          </Button>
        </form>
      </SettingsCard>

      <SettingsCard title="Sign-up">
        <Toggle
          label="Allow self-registration"
          hint="Anyone who can reach Trigon can create an email/password account. Turn off once your directory is connected."
          checked={data.general.allowLocalSignup}
          disabled={save.isPending}
          onChange={(v) => save.mutate({ allowLocalSignup: v })}
        />
        {save.error && <p className="mt-3 text-sm text-danger">{save.error.message}</p>}
      </SettingsCard>

      <SettingsCard title="About">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-ink-3">Internal address</dt>
          <dd className="break-all">{data.info.internalUrl}</dd>
          <dt className="text-ink-3">Public address</dt>
          <dd className="break-all">{data.info.publicUrl ?? <span className="text-ink-3">Not set</span>}</dd>
          <dt className="text-ink-3">Microsoft sign-in redirect</dt>
          <dd className="break-all">{data.info.entraRedirectUri || <span className="text-ink-3">Needs a public HTTPS address</span>}</dd>
        </dl>
      </SettingsCard>
    </div>
  );
}
