'use client';

import { useEffect, useRef, useState } from 'react';
import { apiBlob } from '@/lib/api';

/**
 * In-browser Word viewer (docx-preview): renders paragraphs, tables, styles, headers/footers and
 * images to HTML — no Office install needed. Pages are scaled down to fit narrow (phone) screens.
 */
export function DocxViewer({ fileUrl }: { fileUrl: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const styleRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ renderAsync }, blob] = await Promise.all([import('docx-preview'), apiBlob(fileUrl)]);
      if (cancelled || !bodyRef.current) return;
      await renderAsync(blob, bodyRef.current, styleRef.current ?? undefined, {
        className: 'docx',
        inWrapper: true,
        breakPages: true,
        ignoreLastRenderedPageBreak: true,
        renderHeaders: true,
        renderFooters: true,
        renderFootnotes: true,
        renderEndnotes: true,
        useBase64URL: false,
        experimental: true,
      });
      if (!cancelled) setState('ready');
    })().catch((err) => {
      console.error(err);
      if (!cancelled) setState('error');
    });
    return () => {
      cancelled = true;
    };
  }, [fileUrl]);

  // Fit the widest page to the available width.
  useEffect(() => {
    if (state !== 'ready') return;
    const host = hostRef.current;
    const page = bodyRef.current?.querySelector<HTMLElement>('section.docx');
    if (!host || !page) return;
    const fit = () => setZoom(Math.min(1, (host.clientWidth - 24) / page.offsetWidth));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(host);
    return () => ro.disconnect();
  }, [state]);

  return (
    <div ref={hostRef} className="docx-host h-full overflow-auto bg-surface-2 px-3 py-4">
      <div ref={styleRef} />
      {state === 'loading' && <div className="mx-auto aspect-[1/1.414] w-full max-w-2xl animate-pulse rounded-lg bg-surface-3" />}
      {state === 'error' && <p className="p-6 text-center text-danger">This document could not be displayed.</p>}
      <div ref={bodyRef} style={{ zoom }} className="mx-auto w-fit text-black" />
    </div>
  );
}
