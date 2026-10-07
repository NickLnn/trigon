'use client';

import { useEffect, useRef, useState } from 'react';
import { apiBlob } from '@/lib/api';

/** Read-only PowerPoint viewer (pptx-preview): every slide rendered in a scrollable list, fit to width. */
export function PptxViewer({ fileUrl }: { fileUrl: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ init }, blob] = await Promise.all([import('pptx-preview'), apiBlob(fileUrl)]);
      const host = hostRef.current;
      if (cancelled || !host) return;
      host.replaceChildren();
      const width = Math.min(host.clientWidth - 32, 1100);
      const previewer = init(host, { width, height: Math.round((width * 9) / 16), mode: 'list' });
      await previewer.preview(await blob.arrayBuffer());
      if (!cancelled) setState('ready');
    })().catch((err) => {
      console.error(err);
      if (!cancelled) setState('error');
    });
    return () => {
      cancelled = true;
    };
  }, [fileUrl]);

  return (
    <div className="h-full overflow-auto bg-surface-2 px-4 py-4">
      {state === 'loading' && <div className="mx-auto aspect-video w-full max-w-4xl animate-pulse rounded-lg bg-surface-3" />}
      {state === 'error' && <p className="p-6 text-center text-danger">This presentation could not be displayed. Older .ppt files aren&apos;t supported — download to open it.</p>}
      <div ref={hostRef} className="pptx-host mx-auto w-full max-w-[1100px]" />
    </div>
  );
}
