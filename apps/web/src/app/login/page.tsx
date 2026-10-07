'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuthConfig } from '@trigon/shared';
import { Building2, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { Logo } from '@/components/ui/logo';
import { api } from '@/lib/api';

type Mode = 'signin' | 'register' | 'ldap';

function MicrosoftLogo() {
  return (
    <svg viewBox="0 0 21 21" className="size-5" aria-hidden>
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

const field = 'w-full rounded-2xl bg-surface-2 px-4 py-3.5 text-[1rem] outline-none ring-accent placeholder:text-ink-3 focus:ring-2';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const returnTo = params.get('returnTo')?.startsWith('/') ? params.get('returnTo')! : '/';
  const { data: config } = useQuery({ queryKey: ['auth-config'], queryFn: () => api<AuthConfig>('/auth/config') });
  const [mode, setMode] = useState<Mode>('signin');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(params.get('error'));

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    setBusy(true);
    setError(null);
    try {
      const path = mode === 'register' ? '/auth/register' : mode === 'ldap' ? '/auth/ldap' : '/auth/login';
      const user = await api(path, { method: 'POST', json: form });
      qc.setQueryData(['session'], user);
      router.replace(returnTo);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pb-8 pt-[max(3rem,env(safe-area-inset-top))]">
      <Logo size={44} tagline />
      <h1 className="mt-8 text-display font-bold">{mode === 'register' ? 'Create account' : 'Welcome back'}</h1>
      <p className="mt-2 text-ink-2">{mode === 'ldap' ? 'Sign in with your domain account.' : 'Your team’s knowledge, in one place.'}</p>

      {config?.entra.enabled && mode !== 'register' && (
        <a
          href={`/api/auth/entra/login?returnTo=${encodeURIComponent(returnTo)}`}
          className="press mt-8 flex items-center justify-center gap-3 rounded-pill border border-line bg-surface py-3.5 font-semibold shadow-card"
        >
          <MicrosoftLogo /> Continue with Microsoft
        </a>
      )}

      {config && (config.ldap.enabled || config.entra.enabled) && mode !== 'register' && (
        <div className="mt-4 flex rounded-pill bg-surface-2 p-1 text-sm font-semibold">
          {(['signin', ...(config.ldap.enabled ? ['ldap'] : [])] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 rounded-pill py-2 transition ${mode === m ? 'bg-surface shadow-card' : 'text-ink-3'}`}
            >
              {m === 'ldap' ? (
                <span className="inline-flex items-center gap-1.5">
                  <Building2 className="size-4" /> Domain
                </span>
              ) : (
                'Email'
              )}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={submit} className="mt-6 space-y-3">
        {mode === 'register' && <input name="displayName" required placeholder="Full name" autoComplete="name" className={field} />}
        {mode === 'ldap' ? (
          <input name="username" required placeholder="DOMAIN\\user or user@company.com" autoComplete="username" autoCapitalize="none" className={field} />
        ) : (
          <input name="email" type="email" required placeholder="Email" autoComplete="email" autoCapitalize="none" className={field} />
        )}
        <div className="relative">
          <input
            name="password"
            type={show ? 'text' : 'password'}
            required
            minLength={mode === 'register' ? 10 : undefined}
            placeholder="Password"
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            className={`${field} pr-12`}
          />
          <button type="button" onClick={() => setShow((s) => !s)} className="absolute inset-y-0 right-3 grid place-items-center px-1 text-ink-3" aria-label={show ? 'Hide password' : 'Show password'}>
            {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
          </button>
        </div>
        {error && <p className="rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>}
        <button disabled={busy} className="press flex w-full items-center justify-center gap-2 rounded-pill bg-accent py-3.5 font-semibold text-accent-ink disabled:opacity-60">
          {busy && <Loader2 className="size-4 animate-spin" />}
          {mode === 'register' ? 'Create account' : 'Sign in'}
        </button>
      </form>

      {config?.local.signup && mode !== 'ldap' && (
        <p className="mt-auto pt-8 text-center text-ink-2">
          {mode === 'register' ? 'Already have an account? ' : 'New to Trigon? '}
          <button className="font-semibold text-accent" onClick={() => setMode(mode === 'register' ? 'signin' : 'register')}>
            {mode === 'register' ? 'Sign in' : 'Create an account'}
          </button>
        </p>
      )}
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
