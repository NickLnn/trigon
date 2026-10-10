'use client';

import { Download, PlusSquare, Share } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useIsStandalone } from '@/lib/use-media';
import { BottomSheet } from './bottom-sheet';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Set the first time the offer is shown — it never opens by itself again on this device. */
const SHOWN_KEY = 'trigon.install.offered';
/** Fire this to open the sheet on demand (Profile → Install app). */
export const OPEN_INSTALL_EVENT = 'trigon-open-install';

function alreadyOffered() {
  try {
    return localStorage.getItem(SHOWN_KEY) === '1';
  } catch {
    return true; // no storage → don't nag on every visit
  }
}

function markOffered() {
  try {
    localStorage.setItem(SHOWN_KEY, '1');
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
    if (standalone !== false) return;
    setIos(isIos());
    const auto = !alreadyOffered();
    const show = () => {
      markOffered();
      setOpen(true);
    };
    let t: ReturnType<typeof setTimeout> | undefined;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      if (auto) t = setTimeout(show, 8000);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    if (isIos() && auto) t = setTimeout(show, 8000);
    window.addEventListener(OPEN_INSTALL_EVENT, show);
    return () => {
      clearTimeout(t);
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener(OPEN_INSTALL_EVENT, show);
    };
  }, [standalone]);

  if (standalone !== false) return null;

  return (
    <BottomSheet open={open} onOpenChange={setOpen} title="Install Trigon" description="Get the full-screen app with offline access — right from your home screen.">
      <div className="flex items-center gap-4 rounded-2xl bg-surface-2 p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-192.png" alt="" className="size-14 rounded-2xl shadow-card" />
        <div>
          <p className="font-semibold">Trigon</p>
          <p className="text-meta text-ink-3">Docs, spaces and search — offline-ready</p>
        </div>
      </div>
      {!deferred && !ios ? (
        <p className="mt-5 rounded-2xl bg-surface-2 p-4 text-sm text-ink-2">
          Use your browser&apos;s menu → <b>Install app</b> (or <b>Add to Home Screen</b> on Android). If it isn&apos;t offered, Trigon needs to be opened over
          <b> HTTPS</b> — browsers only allow installing secure sites.
        </p>
      ) : ios && !deferred ? (
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
      <button className="mt-2 w-full py-3 text-ink-2" onClick={() => setOpen(false)}>
        Not now
      </button>
    </BottomSheet>
  );
}
