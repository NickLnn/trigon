'use client';

import { AlertTriangle } from 'lucide-react';
import { SettingsCard, Toggle } from '@/components/settings/ui';
import { useSaveSettings, useSettings } from '@/lib/admin-queries';

export default function GeneralSettingsPage() {
  const { data } = useSettings();
  const save = useSaveSettings('general');
  if (!data) return <div className="h-40 animate-pulse rounded-card bg-surface" />;

  return (
    <div className="space-y-5">
      {data.info.httpsWarning && (
        <div className="flex gap-3 rounded-card bg-warning/12 p-4 text-sm">
          <AlertTriangle className="size-5 shrink-0 text-warning" />
          <p>
            Trigon is served over plain HTTP (<b>{data.info.appUrl}</b>). Install-to-home-screen, offline mode and Microsoft sign-in need
            HTTPS — put a reverse proxy with a certificate in front, then set <code>APP_URL</code> to the https address.
          </p>
        </div>
      )}
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
          <dt className="text-ink-3">Public URL</dt>
          <dd className="truncate">{data.info.appUrl}</dd>
          <dt className="text-ink-3">Entra redirect URI</dt>
          <dd className="break-all">{data.info.entraRedirectUri}</dd>
        </dl>
      </SettingsCard>
    </div>
  );
}
