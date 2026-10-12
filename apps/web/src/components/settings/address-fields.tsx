'use client';

import { useEffect, useState } from 'react';
import { Field, TextInput } from '@/components/settings/ui';

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|[^.]+$|.+\.(local|lan|home|internal)$)/i;

/** What the browser is on right now, sorted into "internal" (LAN / plain http) and "public" (HTTPS, real domain). */
export function useCurrentAddress() {
  const [here, setHere] = useState<{ origin: string; isPublic: boolean } | null>(null);
  useEffect(() => {
    const { origin, protocol, hostname } = window.location;
    setHere({ origin, isPublic: protocol === 'https:' && !PRIVATE_HOST.test(hostname) });
  }, []);
  return here;
}

/** Internal + public address inputs with a one-click "use the address you're on" suggestion. */
export function AddressFields({
  internalUrl,
  publicUrl,
  onChange,
}: {
  internalUrl: string;
  publicUrl: string;
  onChange: (patch: { internalUrl?: string; publicUrl?: string }) => void;
}) {
  const here = useCurrentAddress();
  const suggest = (field: 'internalUrl' | 'publicUrl', value: string) =>
    here && value !== here.origin && (field === 'publicUrl') === here.isPublic ? (
      <button type="button" onClick={() => onChange({ [field]: here.origin })} className="font-semibold text-accent">
        Use {here.origin}
      </button>
    ) : null;
  return (
    <div className="space-y-4">
      <Field
        label="Internal address"
        hint={
          <>
            How people on your network reach Trigon, e.g. http://192.168.x.x:8797. {suggest('internalUrl', internalUrl)}
          </>
        }
      >
        <TextInput value={internalUrl} onChange={(e) => onChange({ internalUrl: e.target.value })} placeholder="http://192.168.x.x:8797" autoCapitalize="none" inputMode="url" />
      </Field>
      <Field
        label="Public address"
        hint={
          <>
            The HTTPS address used from anywhere (e.g. through Cloudflare). Used in emails and for Microsoft sign-in. Leave empty if Trigon is only used on your network. {suggest('publicUrl', publicUrl)}
          </>
        }
      >
        <TextInput value={publicUrl} onChange={(e) => onChange({ publicUrl: e.target.value })} placeholder="https://trigon.example.com" autoCapitalize="none" inputMode="url" />
      </Field>
    </div>
  );
}
