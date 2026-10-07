'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type Theme } from '@/lib/theme';

const OPTIONS: [Theme, typeof Sun, string][] = [
  ['light', Sun, 'Light'],
  ['dark', Moon, 'Dark'],
  ['system', Monitor, 'Auto'],
];

/** Compact segmented light / dark / auto switch. */
export function ThemeSwitch({ className = '' }: { className?: string }) {
  const [theme, setTheme] = useTheme();
  return (
    <div className={`flex rounded-pill bg-surface-2 p-0.5 ${className}`} role="radiogroup" aria-label="Theme">
      {OPTIONS.map(([t, Icon, label]) => (
        <button
          key={t}
          role="radio"
          aria-checked={theme === t}
          title={label}
          onClick={() => setTheme(t)}
          className={`grid size-7 place-items-center rounded-full transition ${theme === t ? 'bg-surface text-ink shadow-card' : 'text-ink-3 hover:text-ink'}`}
        >
          <Icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}
