'use client';

import { Building2, ChevronLeft, ChevronRight, SlidersHorizontal, UserRound, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useSession } from '@/lib/session';
import { useIsDesktop } from '@/lib/use-media';

function MicrosoftIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 21 21" className={className} aria-hidden>
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

const SETTINGS_SECTIONS = [
  { href: '/settings/general', label: 'General', hint: 'Sign-up and workspace defaults', icon: SlidersHorizontal },
  { href: '/settings/entra', label: 'Microsoft Entra ID', hint: 'Microsoft sign-in and directory sync', icon: MicrosoftIcon },
  { href: '/settings/ldap', label: 'LDAP / Active Directory', hint: 'Domain sign-in and group sync', icon: Building2 },
  { href: '/settings/users', label: 'Users', hint: 'Roles, access and passwords', icon: UserRound },
  { href: '/settings/groups', label: 'Groups', hint: 'Local and synced groups', icon: Users },
] as const;

/** Admin area: section list + content side-by-side on desktop, drill-down on phones. */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const isDesktop = useIsDesktop();
  const isIndex = pathname === '/settings';
  const current = SETTINGS_SECTIONS.find((s) => pathname.startsWith(s.href));

  useEffect(() => {
    if (isDesktop && isIndex) router.replace('/settings/general');
  }, [isDesktop, isIndex, router]);

  if (user && user.role !== 'admin') {
    return <p className="p-10 text-center text-ink-2">Settings are only available to administrators.</p>;
  }

  const nav = (
    <nav className="space-y-1">
      {SETTINGS_SECTIONS.map(({ href, label, hint, icon: Icon }) => {
        const active = pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`press flex items-center gap-3 rounded-2xl px-3 py-2.5 ${active ? 'bg-surface shadow-card' : 'hover:bg-surface/60'}`}
          >
            <span className={`grid size-9 shrink-0 place-items-center rounded-full ${active ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-ink-2'}`}>
              <Icon className="size-4.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{label}</span>
              <span className="block truncate text-meta text-ink-3">{hint}</span>
            </span>
            <ChevronRight className="size-4 text-ink-3 md:hidden" />
          </Link>
        );
      })}
    </nav>
  );

  if (!isDesktop) {
    return (
      <div className="px-4 pb-12 pt-[max(1rem,env(safe-area-inset-top))]">
        {isIndex ? (
          <>
            <h1 className="mb-5 mt-2 px-1 text-display font-bold">Settings</h1>
            {nav}
          </>
        ) : (
          <>
            <Link href="/settings" className="mb-2 inline-flex items-center gap-1 rounded-full py-2 pr-3 font-medium text-ink-2">
              <ChevronLeft className="size-5" /> Settings
            </Link>
            <h1 className="mb-5 px-1 text-title font-bold">{current?.label}</h1>
            {children}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl gap-8 px-10 py-8">
      <aside className="w-72 shrink-0">
        <h1 className="mb-5 px-1 text-display font-bold">Settings</h1>
        {nav}
      </aside>
      <div className="min-w-0 flex-1 pt-16">
        <h2 className="mb-5 text-title font-bold">{current?.label}</h2>
        <div className="space-y-5">{children}</div>
      </div>
    </div>
  );
}
