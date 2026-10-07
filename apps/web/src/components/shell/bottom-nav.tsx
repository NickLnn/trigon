'use client';

import { Home, LayoutGrid, Search, UserRound } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export const NAV_ITEMS = [
  { href: '/', label: 'Home', icon: Home, match: (p: string) => p === '/' },
  { href: '/spaces', label: 'Workspaces', icon: LayoutGrid, match: (p: string) => p.startsWith('/spaces') || p.startsWith('/d/') },
  { href: '/search', label: 'Search', icon: Search, match: (p: string) => p.startsWith('/search') },
  { href: '/profile', label: 'Profile', icon: UserRound, match: (p: string) => p.startsWith('/profile') },
] as const;

/** Mobile tab bar: frosted glass, safe-area aware, with a sliding active indicator. */
export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="glass fixed inset-x-0 bottom-0 z-30 border-t border-line pb-safe" aria-label="Primary">
      <ul className="mx-auto flex max-w-lg">
        {NAV_ITEMS.map(({ href, label, icon: Icon, match }) => {
          const active = match(pathname);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                className={`press relative flex flex-col items-center gap-1 pb-2 pt-2.5 text-[0.6875rem] font-medium ${active ? 'text-ink' : 'text-ink-3'}`}
                aria-current={active ? 'page' : undefined}
              >
                {active && (
                  <motion.span
                    layoutId="bottom-nav-pill"
                    className="absolute top-1.5 h-8 w-14 rounded-full bg-surface-2"
                    transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                  />
                )}
                <Icon className="relative size-[1.375rem]" strokeWidth={active ? 2.4 : 1.9} />
                <span className="relative">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
