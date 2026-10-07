'use client';

import { useEffect, useState } from 'react';

export type Theme = 'system' | 'light' | 'dark';
const KEY = 'trigon.theme';

/** Light / dark / follow-system, persisted per device and applied via <html data-theme>. */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>('system');
  useEffect(() => {
    try {
      setThemeState((localStorage.getItem(KEY) as Theme) ?? 'system');
    } catch {
      /* storage unavailable */
    }
    const onChange = (e: Event) => setThemeState((e as CustomEvent<Theme>).detail);
    window.addEventListener('trigon-theme', onChange);
    return () => window.removeEventListener('trigon-theme', onChange);
  }, []);

  const setTheme = (t: Theme) => {
    try {
      if (t === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, t);
    } catch {
      /* storage unavailable */
    }
    if (t === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    window.dispatchEvent(new CustomEvent('trigon-theme', { detail: t }));
  };
  return [theme, setTheme];
}
