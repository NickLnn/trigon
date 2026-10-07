'use client';

import { animate, motion, useMotionValue, useTransform } from 'motion/react';
import { RefreshCw } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';

const THRESHOLD = 72;

/**
 * Touch pull-to-refresh with resistance, driven by motion values (GPU transforms only, no layout).
 * Only engages when the page is scrolled to the very top.
 */
export function PullToRefresh({ onRefresh, children }: { onRefresh: () => Promise<unknown>; children: ReactNode }) {
  const y = useMotionValue(0);
  const rotate = useTransform(y, [0, THRESHOLD], [0, 270]);
  const opacity = useTransform(y, [0, THRESHOLD * 0.6, THRESHOLD], [0, 0.6, 1]);
  const start = useRef<number | null>(null);
  const [busy, setBusy] = useState(false);

  const onTouchStart = (e: React.TouchEvent) => {
    if (busy || window.scrollY > 0) return;
    start.current = e.touches[0].clientY;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (start.current === null) return;
    const delta = e.touches[0].clientY - start.current;
    if (delta <= 0) return y.set(0);
    y.set(Math.min(THRESHOLD * 1.6, delta * 0.5)); // resistance
  };
  const onTouchEnd = async () => {
    if (start.current === null) return;
    start.current = null;
    if (y.get() >= THRESHOLD) {
      setBusy(true);
      navigator.vibrate?.(8);
      animate(y, THRESHOLD * 0.75, { type: 'spring', stiffness: 400, damping: 30 });
      try {
        await onRefresh();
      } finally {
        setBusy(false);
        animate(y, 0, { type: 'spring', stiffness: 400, damping: 35 });
      }
    } else {
      animate(y, 0, { type: 'spring', stiffness: 500, damping: 35 });
    }
  };

  return (
    <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} className="relative">
      <motion.div style={{ opacity, height: y }} className="pointer-events-none flex items-end justify-center overflow-hidden">
        <motion.span style={{ rotate }} className={`mb-3 grid size-9 place-items-center rounded-full bg-surface shadow-card ${busy ? 'animate-spin' : ''}`}>
          <RefreshCw className="size-4 text-accent" />
        </motion.span>
      </motion.div>
      {children}
    </div>
  );
}
