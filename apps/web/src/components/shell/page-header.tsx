'use client';

import { ChevronLeft } from 'lucide-react';
import { motion, useScroll, useTransform } from 'motion/react';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

/**
 * iOS/fintech-style header: a large title that collapses into a compact frosted bar on scroll.
 */
export function PageHeader({ title, subtitle, back, actions }: { title: string; subtitle?: ReactNode; back?: boolean; actions?: ReactNode }) {
  const router = useRouter();
  const { scrollY } = useScroll();
  const compactOpacity = useTransform(scrollY, [40, 80], [0, 1]);
  const largeOpacity = useTransform(scrollY, [0, 50], [1, 0]);

  return (
    <>
      <div className="glass sticky top-0 z-20 pt-safe md:bg-transparent md:backdrop-blur-none">
        <div className="relative flex h-12 items-center gap-1 px-2 md:h-14 md:px-6">
          {back ? (
            <button onClick={() => router.back()} className="press grid size-10 place-items-center rounded-full hover:bg-surface-2" aria-label="Back">
              <ChevronLeft className="size-6" />
            </button>
          ) : (
            <span className="w-2" />
          )}
          <motion.span style={{ opacity: compactOpacity }} className="pointer-events-none absolute inset-x-16 truncate text-center font-semibold md:hidden">
            {title}
          </motion.span>
          <div className="ml-auto flex items-center gap-1">{actions}</div>
        </div>
      </div>
      <motion.div style={{ opacity: largeOpacity }} className="px-5 pb-4 md:px-10 md:opacity-100!">
        <h1 className="text-display font-bold">{title}</h1>
        {subtitle && <div className="mt-1 text-ink-2">{subtitle}</div>}
      </motion.div>
    </>
  );
}

export function IconButton({ label, onClick, children }: { label: string; onClick?: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} className="press grid size-10 place-items-center rounded-full bg-surface shadow-card hover:bg-surface-2">
      {children}
    </button>
  );
}
