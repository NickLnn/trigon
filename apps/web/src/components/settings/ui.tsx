'use client';

import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import type { InputHTMLAttributes, ReactNode } from 'react';

export function SettingsCard({ title, description, children, actions }: { title?: string; description?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-card bg-surface p-5 shadow-card md:p-6">
      {(title || actions) && (
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            {title && <h2 className="text-lg font-bold">{title}</h2>}
            {description && <p className="mt-1 text-sm text-ink-2">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-meta text-ink-3">{hint}</span>}
    </label>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-xl bg-surface-2 px-3.5 py-2.5 text-[0.9375rem] outline-none ring-accent placeholder:text-ink-3 focus:ring-2 disabled:opacity-60 ${props.className ?? ''}`}
    />
  );
}

export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 text-left disabled:opacity-60"
    >
      <span>
        <span className="block font-semibold">{label}</span>
        {hint && <span className="block text-sm text-ink-2">{hint}</span>}
      </span>
      <span className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-surface-3'}`}>
        <span className={`absolute top-0.5 size-6 rounded-full bg-white shadow transition-transform duration-200 ${checked ? 'translate-x-5.5' : 'translate-x-0.5'}`} />
      </span>
    </button>
  );
}

export function Button({
  children,
  variant = 'primary',
  busy,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger'; busy?: boolean }) {
  const styles = {
    primary: 'bg-accent text-accent-ink',
    secondary: 'bg-surface-2 text-ink hover:bg-surface-3',
    danger: 'bg-danger/10 text-danger hover:bg-danger/15',
  }[variant];
  return (
    <button
      {...props}
      disabled={busy || props.disabled}
      className={`press inline-flex items-center justify-center gap-2 rounded-pill px-4 py-2.5 text-sm font-semibold disabled:opacity-60 ${styles} ${props.className ?? ''}`}
    >
      {busy && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Result({ result }: { result: { ok: boolean; message: string } | null | undefined }) {
  if (!result) return null;
  return (
    <p className={`flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-sm ${result.ok ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>
      {result.ok ? <CheckCircle2 className="mt-px size-4 shrink-0" /> : <XCircle className="mt-px size-4 shrink-0" />}
      <span>{result.message}</span>
    </p>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'success' | 'danger' | 'warning' }) {
  const styles = {
    neutral: 'bg-surface-2 text-ink-2',
    accent: 'bg-accent-soft text-accent',
    success: 'bg-success/12 text-success',
    danger: 'bg-danger/10 text-danger',
    warning: 'bg-warning/15 text-[#a36a00] dark:text-warning',
  }[tone];
  return <span className={`inline-flex items-center rounded-pill px-2.5 py-0.5 text-meta font-semibold ${styles}`}>{children}</span>;
}
