'use client';

import { useSyncExternalStore } from 'react';

/**
 * Subscribe to a media query. Returns `undefined` during SSR/hydration so callers can render
 * neither layout until the real viewport is known (no mobile→desktop flash, no duplicate DOM).
 */
export function useMediaQuery(query: string): boolean | undefined {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => undefined,
  );
}

export const useIsDesktop = () => useMediaQuery('(min-width: 768px)');

/** True when launched from the home screen (installed PWA). */
export const useIsStandalone = () =>
  useMediaQuery('(display-mode: standalone)') ||
  (typeof navigator !== 'undefined' && (navigator as Navigator & { standalone?: boolean }).standalone === true);
