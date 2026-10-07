'use client';

import { Download, PlusSquare, Share } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useIsStandalone } from '@/lib/use-media';
import { BottomSheet } from './bottom-sheet';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'trigon.install.dismissedAt';
const SNOOZE_DAYS = 14;

function snoozed() {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    return Date.now() - at < SNOOZE_DAYS * 86_400_000;
  } catch {
    return false;
  }
}

function snooze() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    /* storage unavailable */
  }
}

const isIos = () =>
  typeof navigator !== 'undefined' &&
  (/iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

/**
 * "Add to Home Screen": uses the native prompt on Android/Chromium (beforeinstallprompt) and shows
 * step-by-step Share → Add to Home Screen instructions on iOS Safari, which has no prompt API.
 */
export function InstallPrompt() {
  const standalone = useIsStandalone();
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [open, setOpen] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    if (standalone !== false || snoozed()) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setTimeout(() => setOpen(true), 4000);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    if (isIos()) {
      setIos(true);
      const t = setTimeout(() => setOpen(true), 6000);
      return () => {
        clearTimeout(t);
        window.removeEventListener('beforeinstallprompt', onPrompt);
      };
    }
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, [standalone]);

  const close = (v: boolean) => {
    setOpen(v);
    if (!v) snooze();
  };

  if (standalone !== false || (!deferred && !ios)) return null;

  return (
    <BottomSheet open={open} onOpenChange={close} title="Install Trigon" description="Get the full-screen app with offline access — right from your home screen.">
      <div className="flex items-center gap-4 rounded-2xl bg-surface-2 p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-192.png" alt="" className="size-14 rounded-2xl shadow-card" />
        <div>
          <p className="font-semibold">Trigon</p>
          <p className="text-meta text-ink-3">Docs, spaces and search — offline-ready</p>
        </div>
      </div>
      {ios && !deferred ? (
        <ol className="mt-5 space-y-3">
          <li className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-full bg-accent-soft text-accent">
              <Share className="size-4" />
            </span>
            Tap <b>Share</b> in Safari&apos;s toolbar
          </li>
          <li className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-full bg-accent-soft text-accent">
              <PlusSquare className="size-4" />
            </span>
            Choose <b>Add to Home Screen</b>
          </li>
        </ol>
      ) : (
        <button
          className="press mt-5 flex w-full items-center justify-center gap-2 rounded-pill bg-accent py-3.5 font-semibold text-accent-ink"
          onClick={async () => {
            await deferred?.prompt();
            await deferred?.userChoice;
            setDeferred(null);
            setOpen(false);
          }}
        >
          <Download className="size-4" /> Install app
        </button>
      )}
      <button className="mt-2 w-full py-3 text-ink-2" onClick={() => close(false)}>
        Not now
      </button>
    </BottomSheet>
  );
}
