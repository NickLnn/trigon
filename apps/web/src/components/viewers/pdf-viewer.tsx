'use client';

import { ChevronDown, ChevronUp, Minus, Plus, Search, X } from 'lucide-react';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiBlob } from '@/lib/api';

type PdfJs = typeof import('pdfjs-dist');
let pdfjsPromise: Promise<PdfJs> | null = null;

/** Load pdf.js lazily (it's large) and point it at its bundled worker. */
function loadPdfJs() {
  pdfjsPromise ??= import('pdfjs-dist').then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
    return lib;
  });
  return pdfjsPromise;
}

interface Hit {
  page: number;
  item: number;
}

interface PageHandle {
  render: (scale: number) => Promise<void>;
  textDivs: () => HTMLElement[];
}

function PdfPage({
  doc,
  pageNumber,
  scale,
  register,
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  register: (n: number, el: HTMLDivElement | null, handle: PageHandle | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(pageNumber <= 2);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const textDivsRef = useRef<HTMLElement[]>([]);

  // Reserve the right amount of space before rendering, so scroll positions and page jumps are stable.
  useEffect(() => {
    doc.getPage(pageNumber).then((p) => {
      const vp = p.getViewport({ scale });
      setSize({ w: vp.width, h: vp.height });
    });
  }, [doc, pageNumber, scale]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !ref.current) return;
    const host = ref.current;
    let cancelled = false;
    let page: PDFPageProxy | null = null;
    const pdfjs = loadPdfJs();

    (async () => {
      const lib = await pdfjs;
      page = await doc.getPage(pageNumber);
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      const ratio = window.devicePixelRatio || 1;
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      if (cancelled) return;

      const textLayerDiv = document.createElement('div');
      textLayerDiv.className = 'textLayer';
      textLayerDiv.style.setProperty('--scale-factor', String(scale));
      textLayerDiv.style.setProperty('--total-scale-factor', String(scale));
      const textLayer = new lib.TextLayer({
        textContentSource: page.streamTextContent(),
        container: textLayerDiv,
        viewport,
      });
      await textLayer.render();
      if (cancelled) return;
      textDivsRef.current = textLayer.textDivs;
      host.replaceChildren(canvas, textLayerDiv);
    })().catch((err) => !cancelled && console.error(err));

    return () => {
      cancelled = true;
      page?.cleanup();
    };
  }, [visible, doc, pageNumber, scale]);

  useEffect(() => {
    register(pageNumber, ref.current, {
      render: async () => setVisible(true),
      textDivs: () => textDivsRef.current,
    });
    return () => register(pageNumber, null, null);
  }, [pageNumber, register]);

  return (
    <div
      ref={ref}
      data-page={pageNumber}
      className="pdf-page"
      style={size ? { width: size.w, height: size.h } : { width: '100%', aspectRatio: '1 / 1.414' }}
    />
  );
}

/**
 * Embedded PDF reader: lazy page rendering, selectable text layer, page jump, zoom and search.
 */
export function PdfViewer({ fileUrl }: { fileUrl: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [current, setCurrent] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [hitIndex, setHitIndex] = useState(0);
  const pages = useRef(new Map<number, { el: HTMLDivElement; handle: PageHandle }>());
  const textCache = useRef(new Map<number, string[]>());

  useEffect(() => {
    let destroyed = false;
    let task: ReturnType<PdfJs['getDocument']> | null = null;
    (async () => {
      const [lib, blob] = await Promise.all([loadPdfJs(), apiBlob(fileUrl)]);
      if (destroyed) return;
      task = lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
      const loaded = await task.promise;
      if (destroyed) return;
      setDoc(loaded);
      // Fit to container width on first load.
      const first = await loaded.getPage(1);
      const width = containerRef.current?.clientWidth ?? 800;
      setScale(Math.min(1.6, Math.max(0.5, (width - 32) / first.getViewport({ scale: 1 }).width)));
    })().catch((err) => setError(err.message ?? 'Could not open PDF'));
    return () => {
      destroyed = true;
      task?.destroy();
    };
  }, [fileUrl]);

  const register = useCallback((n: number, el: HTMLDivElement | null, handle: PageHandle | null) => {
    if (el && handle) pages.current.set(n, { el, handle });
    else pages.current.delete(n);
  }, []);

  // Track the page in view.
  useEffect(() => {
    const root = containerRef.current;
    if (!root || !doc) return;
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) {
          const n = Number((top.target as HTMLElement).dataset.page);
          setCurrent(n);
          setPageInput(String(n));
        }
      },
      { root, threshold: 0.4 },
    );
    root.querySelectorAll('[data-page]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [doc, scale]);

  const goTo = useCallback(
    (n: number) => {
      if (!doc) return;
      const page = Math.min(doc.numPages, Math.max(1, n));
      pages.current.get(page)?.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    [doc],
  );

  const pageText = useCallback(
    async (n: number) => {
      if (!doc) return [];
      const cached = textCache.current.get(n);
      if (cached) return cached;
      const content = await (await doc.getPage(n)).getTextContent();
      const items = content.items.map((i) => ('str' in i ? i.str : ''));
      textCache.current.set(n, items);
      return items;
    },
    [doc],
  );

  // Search all pages (text is cached per page).
  useEffect(() => {
    if (!doc) return;
    const q = query.trim().toLowerCase();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const found: Hit[] = [];
      for (let n = 1; n <= doc.numPages && !cancelled; n++) {
        (await pageText(n)).forEach((s, item) => s.toLowerCase().includes(q) && found.push({ page: n, item }));
      }
      if (!cancelled) {
        setHits(found);
        setHitIndex(0);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, doc, pageText]);

  // Highlight hits in rendered text layers and scroll to the active one.
  useEffect(() => {
    const active = hits[hitIndex];
    const paint = () => {
      pages.current.forEach(({ handle }, n) => {
        handle.textDivs().forEach((div, i) => {
          const isHit = hits.some((h) => h.page === n && h.item === i);
          div.classList.toggle('pdf-hit', isHit);
          div.classList.toggle('pdf-hit-active', !!active && active.page === n && active.item === i);
        });
      });
    };
    paint();
    if (active) {
      const entry = pages.current.get(active.page);
      entry?.handle.render(scale);
      const div = entry?.handle.textDivs()[active.item];
      if (div) div.scrollIntoView({ behavior: 'smooth', block: 'center' });
      else goTo(active.page);
    }
    const t = setTimeout(paint, 500); // pages that just rendered
    return () => clearTimeout(t);
  }, [hits, hitIndex, scale, goTo]);

  if (error) return <p className="p-6 text-center text-danger">{error}</p>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="glass sticky top-0 z-10 flex items-center gap-2 border-b border-line px-3 py-2 text-sm">
        {searchOpen ? (
          <>
            <Search className="size-4 shrink-0 text-ink-3" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && hits.length && setHitIndex((i) => (i + (e.shiftKey ? -1 + hits.length : 1)) % hits.length)}
              placeholder="Search in document"
              className="min-w-0 flex-1 bg-transparent outline-none"
            />
            <span className="shrink-0 tabular-nums text-ink-3">{hits.length ? `${hitIndex + 1}/${hits.length}` : query.length > 1 ? '0' : ''}</span>
            <button aria-label="Previous match" className="press rounded-full p-1.5 hover:bg-surface-2" onClick={() => hits.length && setHitIndex((i) => (i - 1 + hits.length) % hits.length)}>
              <ChevronUp className="size-4" />
            </button>
            <button aria-label="Next match" className="press rounded-full p-1.5 hover:bg-surface-2" onClick={() => hits.length && setHitIndex((i) => (i + 1) % hits.length)}>
              <ChevronDown className="size-4" />
            </button>
            <button aria-label="Close search" className="press rounded-full p-1.5 hover:bg-surface-2" onClick={() => { setSearchOpen(false); setQuery(''); }}>
              <X className="size-4" />
            </button>
          </>
        ) : (
          <>
            <form
              className="flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                goTo(Number(pageInput));
              }}
            >
              <input
                value={pageInput}
                onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
                aria-label="Page number"
                className="w-10 rounded-lg bg-surface-2 px-1.5 py-1 text-center tabular-nums outline-none"
              />
              <span className="text-ink-3">/ {doc?.numPages ?? '–'}</span>
            </form>
            <div className="flex-1" />
            <button aria-label="Zoom out" className="press rounded-full p-1.5 hover:bg-surface-2" onClick={() => setScale((s) => Math.max(0.4, +(s - 0.15).toFixed(2)))}>
              <Minus className="size-4" />
            </button>
            <span className="w-11 text-center tabular-nums text-ink-2">{Math.round(scale * 100)}%</span>
            <button aria-label="Zoom in" className="press rounded-full p-1.5 hover:bg-surface-2" onClick={() => setScale((s) => Math.min(3, +(s + 0.15).toFixed(2)))}>
              <Plus className="size-4" />
            </button>
            <button aria-label="Search" className="press rounded-full p-1.5 hover:bg-surface-2" onClick={() => setSearchOpen(true)}>
              <Search className="size-4" />
            </button>
          </>
        )}
      </div>
      <div ref={containerRef} className="min-h-0 flex-1 overflow-auto bg-surface-2 px-4 py-4">
        {!doc ? (
          <div className="mx-auto mt-6 aspect-[1/1.414] w-full max-w-xl animate-pulse rounded-lg bg-surface-3" />
        ) : (
          Array.from({ length: doc.numPages }, (_, i) => (
            <PdfPage key={`${i + 1}-${scale}`} doc={doc} pageNumber={i + 1} scale={scale} register={register} />
          ))
        )}
      </div>
      <span className="sr-only" aria-live="polite">
        Page {current}
      </span>
    </div>
  );
}
