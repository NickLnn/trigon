'use client';

import { AnimatePresence, motion } from 'motion/react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { InstallPrompt } from '@/components/ui/install-prompt';
import { useSession } from '@/lib/session';
import { useIsDesktop } from '@/lib/use-media';
import { BottomNav } from './bottom-nav';
import { Sidebar } from './sidebar';

function Splash() {
  return (
    <div className="grid h-dvh place-items-center bg-bg">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/icon-192.png" alt="" className="size-16 animate-pulse rounded-2xl" />
    </div>
  );
}

/**
 * Authenticated chrome. Exactly one layout is mounted: the mobile shell (content + bottom tab bar)
 * or the desktop workspace (sidebar tree + content). Pages render once, inside whichever is active.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading } = useSession();
  const isDesktop = useIsDesktop();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) router.replace(`/login?returnTo=${encodeURIComponent(pathname)}`);
  }, [loading, user, router, pathname]);

  if (loading || !user || isDesktop === undefined) return <Splash />;

  if (isDesktop) {
    return (
      <div className="flex min-h-dvh">
        <Sidebar />
        <main className="min-w-0 flex-1">{children}</main>
        <InstallPrompt />
      </div>
    );
  }

  return (
    <div className="min-h-dvh pb-[calc(4.25rem+env(safe-area-inset-bottom))]">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.main
          key={pathname}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ type: 'spring', stiffness: 420, damping: 40, mass: 0.8 }}
          className="will-change-transform"
        >
          {children}
        </motion.main>
      </AnimatePresence>
      <BottomNav />
      <InstallPrompt />
    </div>
  );
}
