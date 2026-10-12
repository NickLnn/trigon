'use client';

import type { EmailProvider, EmailSettings } from '@trigon/shared';
import { useQuery } from '@tanstack/react-query';
import { Check, Copy, Eye, Mail, MailX, Send, Server, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { Badge, Button, Field, Result, SettingsCard, TextInput, Toggle } from '@/components/settings/ui';
import { useEmailMicrosoftStatus, useEmailTest, useSaveSettings, useSettings } from '@/lib/admin-queries';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

function MicrosoftLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 21 21" className={className} aria-hidden>
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

/** Provider marks: Microsoft 365 uses Microsoft's own Outlook icon; SMTP isn't a brand, so it gets a neutral mail-server tile. */
const PROVIDER_ICON: Record<EmailProvider, ReactNode> = {
  none: (
    <span className="grid size-11 place-items-center rounded-2xl bg-surface-3 text-ink-3">
      <MailX className="size-5" />
    </span>
  ),
  smtp: (
    <span className="relative grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-[#5b6b8c] to-[#2e3a55] text-white shadow-sm">
      <Mail className="size-5" />
      <span className="absolute -bottom-1 -right-1 grid size-5 place-items-center rounded-md bg-surface text-ink-2 shadow-sm ring-1 ring-line">
        <Server className="size-3" />
      </span>
    </span>
  ),
  microsoft: (
    <span className="relative grid size-11 place-items-center rounded-2xl bg-white shadow-sm ring-1 ring-line">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/outlook.svg" alt="" width={30} height={30} draggable={false} />
      <span className="absolute -bottom-1 -right-1 grid size-5 place-items-center rounded-md bg-white shadow-sm ring-1 ring-line">
        <MicrosoftLogo className="size-3" />
      </span>
    </span>
  ),
};

const PROVIDERS: { value: EmailProvider; label: string; hint: string }[] = [
  { value: 'none', label: 'Off', hint: 'Trigon sends no email.' },
  { value: 'smtp', label: 'SMTP server', hint: 'Any mail server or relay: your own, Microsoft 365 SMTP, Gmail, SendGrid…' },
  { value: 'microsoft', label: 'Microsoft 365', hint: 'Exchange Online through the Trigon app registration. No SMTP needed.' },
];

/** Common servers: fill host, port and encryption in one click. */
const PRESETS = [
  { label: 'Microsoft 365', host: 'smtp.office365.com', port: 587, security: 'starttls' },
  { label: 'Gmail / Google Workspace', host: 'smtp.gmail.com', port: 587, security: 'starttls' },
  { label: 'Implicit TLS (465)', host: '', port: 465, security: 'tls' },
  { label: 'LAN relay (25)', host: '', port: 25, security: 'none' },
] as const;

const SECURITY: { value: EmailSettings['smtpSecurity']; label: string }[] = [
  { value: 'starttls', label: 'STARTTLS' },
  { value: 'tls', label: 'TLS' },
  { value: 'none', label: 'None' },
];

/** PowerShell an Exchange admin runs once to limit Mail.Send to the sender mailbox. */
const restrictScript = (mailbox: string, appId: string) =>
  `Connect-ExchangeOnline
New-DistributionGroup -Name "Trigon senders" -Type Security -Members ${mailbox || '<sender mailbox>'}
New-ApplicationAccessPolicy -AppId ${appId || '<Trigon app id>'} -PolicyScopeGroupId "Trigon senders" -AccessRight RestrictAccess -Description "Trigon may only send as its sender mailbox"`;

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

export default function EmailSettingsPage() {
  const { data } = useSettings();
  const { user } = useSession();
  const save = useSaveSettings('email');
  const test = useEmailTest();
  const [form, setForm] = useState<EmailSettings | null>(null);
  const [to, setTo] = useState('');
  const entraConnected = !!data && data.entra.enabled && !!data.entra.clientId && !!data.entra.hasClientSecret;
  const ms = useEmailMicrosoftStatus(entraConnected && form?.provider === 'microsoft');
  const previews = useQuery({ queryKey: ['email-previews'], queryFn: () => api<{ kind: string; label: string }[]>('/settings/email/previews') });

  useEffect(() => {
    if (data) setForm({ ...data.email, smtpPassword: '' });
  }, [data]);
  useEffect(() => {
    if (user && !to) setTo(user.email);
  }, [user, to]);

  if (!data || !form) return <div className="h-60 animate-pulse rounded-card bg-surface" />;
  const set = (patch: Partial<EmailSettings>) => {
    setForm((f) => ({ ...f!, ...patch }));
    test.reset();
  };
  // The API rejects read-only flags (hasSmtpPassword).
  const payload = () => {
    const { hasSmtpPassword: _ignored, ...rest } = form;
    return rest as EmailSettings;
  };
  const active = data.email.provider !== 'none' && !!data.email.fromAddress;
  const granted = ms.data?.mailSend === 'granted';

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(payload());
      }}
    >
      <SettingsCard
        title="How Trigon sends email"
        description="Used for notifications. Nothing is sent until you choose a method and a sender."
        actions={active ? <Badge tone="success">Active</Badge> : <Badge>Off</Badge>}
      >
        <div className="grid gap-2 sm:grid-cols-3">
          {PROVIDERS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => set({ provider: p.value })}
              aria-pressed={form.provider === p.value}
              className={`press rounded-2xl p-3.5 text-left ring-2 ${form.provider === p.value ? 'bg-accent-soft/50 ring-accent' : 'bg-surface-2/60 ring-transparent hover:bg-surface-2'}`}
            >
              {PROVIDER_ICON[p.value]}
              <span className={`mt-3 block font-semibold ${form.provider === p.value ? 'text-accent' : ''}`}>{p.label}</span>
              <span className="mt-1 block text-meta text-ink-3">{p.hint}</span>
            </button>
          ))}
        </div>
      </SettingsCard>

      {form.provider === 'microsoft' && (
        <SettingsCard
          title="Microsoft 365 / Exchange Online"
          description="Trigon sends through Microsoft Graph as the sender mailbox below, using its app registration."
          actions={entraConnected ? <Badge tone={granted ? 'success' : 'warning'}>{granted ? 'Mail.Send granted' : ms.isPending ? 'Checking…' : 'Permission needed'}</Badge> : undefined}
        >
          {!entraConnected ? (
            <div className="space-y-3">
              <Result result={{ ok: false, message: 'Trigon is not connected to Microsoft yet.' }} />
              <Link href="/settings/entra?connect=mail" className="press inline-flex items-center gap-2 rounded-pill bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink">
                <Sparkles className="size-4" /> Connect to Microsoft with email
              </Link>
            </div>
          ) : granted ? (
            <p className="text-sm text-ink-2">The Trigon app registration may send mail. Choose the sender mailbox below.</p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-ink-2">
                {ms.data?.message ?? 'Checking the app registration…'} Allowing it takes one Microsoft admin sign-in; you&apos;ll see exactly which permissions are granted first.
              </p>
              <Link href="/settings/entra?connect=mail" className="press inline-flex items-center gap-2 rounded-pill bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink">
                <Mail className="size-4" /> Allow Trigon to send email
              </Link>
            </div>
          )}
          {entraConnected && (
            <details className="mt-4 rounded-xl bg-surface-2/60 p-4">
              <summary className="cursor-pointer text-sm font-semibold">Recommended: limit Trigon to the sender mailbox</summary>
              <p className="mt-3 text-sm text-ink-2">
                Mail.Send lets an app send as any mailbox. Run this once in Exchange Online PowerShell and Trigon can only send as the sender mailbox (it may take up to an hour to apply):
              </p>
              <div className="mt-3">
                <CopyBlock text={restrictScript(form.fromAddress, data.entra.clientId)} />
              </div>
            </details>
          )}
        </SettingsCard>
      )}

      {form.provider === 'smtp' && (
        <SettingsCard title="SMTP server">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => set({ smtpHost: p.host || form.smtpHost, smtpPort: p.port, smtpSecurity: p.security })}
                  className="press rounded-pill bg-surface-2 px-3 py-1.5 text-meta font-semibold text-ink-2 hover:bg-surface-3"
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="grid gap-4 md:grid-cols-[1fr_7rem]">
              <Field label="Server">
                <TextInput value={form.smtpHost} onChange={(e) => set({ smtpHost: e.target.value.trim() })} placeholder="smtp.example.com" autoCapitalize="none" />
              </Field>
              <Field label="Port">
                <TextInput type="number" min={1} max={65535} value={form.smtpPort} onChange={(e) => set({ smtpPort: Number(e.target.value) || 0 })} />
              </Field>
            </div>
            <Field label="Encryption" hint="STARTTLS on 587 is the usual choice; TLS on 465; None only for a relay on your own network.">
              <div className="flex gap-1 rounded-pill bg-surface-2 p-1">
                {SECURITY.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => set({ smtpSecurity: o.value })}
                    className={`flex-1 rounded-pill py-2 text-sm font-semibold ${form.smtpSecurity === o.value ? 'bg-surface shadow-card' : 'text-ink-3'}`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Username" hint="Leave empty for a relay that needs no login.">
                <TextInput value={form.smtpUser} onChange={(e) => set({ smtpUser: e.target.value })} autoComplete="off" autoCapitalize="none" />
              </Field>
              <Field label="Password" hint={data.email.hasSmtpPassword ? 'A password is stored. Leave empty to keep it.' : 'For Microsoft 365 / Gmail with MFA, use an app password.'}>
                <TextInput
                  type="password"
                  autoComplete="new-password"
                  value={form.smtpPassword ?? ''}
                  onChange={(e) => set({ smtpPassword: e.target.value })}
                  placeholder={data.email.hasSmtpPassword ? '••••••••••••' : ''}
                />
              </Field>
            </div>
            <Toggle
              label="Verify the server's certificate"
              hint="Turn off only for a mail server with a self-signed certificate."
              checked={form.smtpTlsRejectUnauthorized}
              onChange={(v) => set({ smtpTlsRejectUnauthorized: v })}
            />
          </div>
        </SettingsCard>
      )}

      {form.provider !== 'none' && (
        <SettingsCard title="Sender" description="What people see in the From line.">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="From address" hint={form.provider === 'microsoft' ? 'A licensed user or a shared mailbox in your tenant, e.g. trigon@yourcompany.com.' : 'Must be allowed to send through this server.'}>
              <TextInput type="email" value={form.fromAddress} onChange={(e) => set({ fromAddress: e.target.value.trim() })} placeholder="trigon@example.com" autoCapitalize="none" />
            </Field>
            <Field label="From name" hint={form.provider === 'microsoft' ? 'Exchange shows the mailbox’s own display name.' : undefined}>
              <TextInput value={form.fromName} onChange={(e) => set({ fromName: e.target.value })} placeholder="Trigon" />
            </Field>
          </div>
        </SettingsCard>
      )}

      {form.provider !== 'none' && (
        <SettingsCard title="Send a test email" description="Uses the settings on this page, even before you save them.">
          <div className="flex flex-col gap-2 sm:flex-row">
            <TextInput type="email" value={to} onChange={(e) => setTo(e.target.value.trim())} placeholder="you@example.com" aria-label="Send the test to" />
            <Button type="button" variant="secondary" busy={test.isPending} disabled={!to || !form.fromAddress} onClick={() => test.mutate({ ...payload(), to })}>
              <Send className="size-4" /> Send test
            </Button>
          </div>
          {!form.fromAddress && <p className="mt-2 text-meta text-ink-3">Enter a From address first.</p>}
          <div className="mt-3 space-y-2">
            <Result result={test.data} />
            {test.error && <Result result={{ ok: false, message: test.error.message }} />}
          </div>
        </SettingsCard>
      )}

      <SettingsCard title="Preview the emails" description="Every email Trigon can send, with sample data. Opens in a new tab; nothing is sent.">
        <div className="flex flex-wrap gap-1.5">
          {previews.data?.map((p) => (
            <a
              key={p.kind}
              href={`/api/settings/email/preview/${p.kind}`}
              target="_blank"
              rel="noopener noreferrer"
              className="press inline-flex items-center gap-1.5 rounded-pill bg-surface-2 px-3 py-1.5 text-meta font-semibold text-ink-2 hover:bg-surface-3"
            >
              <Eye className="size-3.5" /> {p.label}
            </a>
          ))}
        </div>
      </SettingsCard>

      {save.error && <Result result={{ ok: false, message: save.error.message }} />}
      {save.isSuccess && !save.isPending && <Result result={{ ok: true, message: 'Saved.' }} />}
      <Button type="submit" busy={save.isPending} disabled={form.provider !== 'none' && !form.fromAddress}>
        Save
      </Button>
    </form>
  );
}
