'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MyNotifications, NotificationPrefs } from '@trigon/shared';
import { CircleCheck, Share2, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { api } from '@/lib/api';

const DIGEST: { value: NotificationPrefs['reviewDigest']; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
];

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-surface-3'}`}
    >
      <span className={`absolute top-0.5 size-6 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5.5' : 'translate-x-0.5'}`} />
    </button>
  );
}

function PrefRow({ icon, title, hint, children }: { icon: ReactNode; title: string; hint: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-ink-2">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{title}</span>
        <span className="block text-meta text-ink-3">{hint}</span>
      </span>
      {children}
    </div>
  );
}

/** Profile → Notifications: which emails this person gets. Saved on every change. */
export function NotificationPrefsSection() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['my-notifications'], queryFn: () => api<MyNotifications>('/me/notifications') });
  const save = useMutation({
    mutationFn: (prefs: NotificationPrefs) => api<MyNotifications>('/me/notifications', { method: 'PUT', json: prefs }),
    onMutate: async (prefs) => {
      const prev = qc.getQueryData<MyNotifications>(['my-notifications']);
      if (prev) qc.setQueryData(['my-notifications'], { ...prev, prefs });
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(['my-notifications'], ctx.prev),
    onSuccess: (fresh) => qc.setQueryData(['my-notifications'], fresh),
  });

  if (!data) return <div className="h-48 animate-pulse rounded-card bg-surface shadow-card" />;
  const set = (patch: Partial<NotificationPrefs>) => save.mutate({ ...data.prefs, ...patch });

  return (
    <div className="overflow-hidden rounded-card bg-surface shadow-card [&>*+*]:border-t [&>*+*]:border-line">
      <p className="px-4 py-3 text-meta text-ink-3">
        {data.emailEnabled ? (
          <>
            Emails go to <span className="font-semibold text-ink-2">{data.email}</span>.
          </>
        ) : (
          'Your administrator hasn’t set up email yet. Your choices are saved and apply as soon as they do.'
        )}
      </p>
      <PrefRow icon={<Share2 className="size-4" />} title="Shared with me" hint="Someone gives you or your group access to a page, folder or space, or changes your access.">
        <Switch label="Shared with me" checked={data.prefs.shares} onChange={(v) => set({ shares: v })} />
      </PrefRow>
      <PrefRow icon={<ShieldCheck className="size-4" />} title="Account changes" hint="Your role changes, your account is deactivated or reactivated, or an admin sets your password.">
        <Switch label="Account changes" checked={data.prefs.account} onChange={(v) => set({ account: v })} />
      </PrefRow>
      <div className="px-4 py-3.5">
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-ink-2">
            <CircleCheck className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium">Pages to review</span>
            <span className="block text-meta text-ink-3">A summary of pages you own that need review or are still drafts. Weekly arrives on Monday mornings.</span>
          </span>
        </div>
        <div className="mt-3 flex gap-1 rounded-pill bg-surface-2 p-1">
          {DIGEST.map((d) => (
            <button
              key={d.value}
              type="button"
              aria-pressed={data.prefs.reviewDigest === d.value}
              onClick={() => set({ reviewDigest: d.value })}
              className={`flex-1 rounded-pill py-2 text-sm font-semibold ${data.prefs.reviewDigest === d.value ? 'bg-surface shadow-card' : 'text-ink-3'}`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>
      {save.error && <p className="px-4 py-3 text-sm text-danger">{save.error.message}</p>}
    </div>
  );
}
