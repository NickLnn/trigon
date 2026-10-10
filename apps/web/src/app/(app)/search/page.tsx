'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Loader2, Search as SearchIcon, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { DocIcon, relativeTime } from '@/components/ui/doc-icon';
import { StatusBadge } from '@/components/ui/status-badge';
import { api, ApiError } from '@/lib/api';
import type { SearchHit } from '@/lib/queries';

/** Escape everything, then re-allow only the <mark> tags produced by ts_headline. */
function safeSnippet(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/&lt;mark&gt;/g, '<mark class="rounded bg-accent-soft px-0.5 text-accent">')
    .replace(/&lt;\/mark&gt;/g, '</mark>');
}

/** Highlight the typed words inside a title. */
function highlight(title: string, q: string) {
  const words = q.toLowerCase().match(/[\p{L}\p{N}]+/gu);
  if (!words?.length) return title;
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return title.split(re).map((part, i) =>
    i % 2 ? (
      <mark key={i} className="rounded bg-accent-soft px-0.5 text-accent">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

/** Wait for a short pause in typing before searching (keeps it fast and under the rate limit). */
function useDebounced(value: string, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function SearchPage() {
  const [q, setQ] = useState('');
  const term = useDebounced(q.trim(), 180);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useQuery({
    queryKey: ['search', term],
    queryFn: () => api<SearchHit[]>(`/documents/search?q=${encodeURIComponent(term)}`),
    enabled: term.length > 0,
    placeholderData: keepPreviousData,
    retry: (count, err) => err instanceof ApiError && err.status === 429 && count < 3,
    retryDelay: 1500,
  });
  const typing = q.trim() !== term;
  const busy = typing || results.isFetching;
  const rateLimited = results.error instanceof ApiError && results.error.status === 429;

  useEffect(() => inputRef.current?.focus(), []);

  return (
    <div className="mx-auto max-w-3xl px-4 pb-10 md:px-10">
      <div className="sticky top-0 z-10 -mx-4 bg-bg px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))] md:pt-8">
        <h1 className="mb-4 text-display font-bold">Search</h1>
        <label className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-3.5 shadow-card ring-accent focus-within:ring-2">
          {busy && q ? <Loader2 className="size-5 animate-spin text-accent" /> : <SearchIcon className="size-5 text-ink-3" />}
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results.data?.[0]) location.assign(`/d/${results.data[0].id}`);
              if (e.key === 'Escape') setQ('');
            }}
            placeholder="Pages, runbooks, files…"
            className="min-w-0 flex-1 bg-transparent text-[1rem] outline-none placeholder:text-ink-3 [box-shadow:none]"
            enterKeyHint="search"
            type="search"
            aria-label="Search"
          />
          {q && (
            <button onClick={() => setQ('')} aria-label="Clear" className="text-ink-3 hover:text-ink">
              <X className="size-5" />
            </button>
          )}
        </label>
        <div className="mt-2 min-h-5 px-1 text-meta text-ink-3" aria-live="polite">
          {rateLimited
            ? 'You’re typing faster than search can keep up — results will catch up in a moment.'
            : results.error
              ? <span className="text-danger">Search failed: {results.error.message}</span>
              : !q
                ? 'Search across every space you have access to. Results appear as you type.'
                : busy
                  ? 'Searching…'
                  : results.data
                    ? `${results.data.length}${results.data.length === 20 ? '+' : ''} result${results.data.length === 1 ? '' : 's'}${results.data.length ? ' — press Enter to open the first' : ''}`
                    : ''}
        </div>
      </div>

      {term && results.data?.length === 0 && !busy && <p className="mt-8 text-center text-ink-3">No results for “{term}”. Try fewer or shorter words.</p>}

      <ul className={`mt-1 space-y-2 transition-opacity ${busy && results.data ? 'opacity-60' : ''}`}>
        {q &&
          results.data?.map((hit) => (
            <li key={hit.id}>
              <Link href={`/d/${hit.id}`} className="press flex gap-3 rounded-card bg-surface p-4 shadow-card hover:ring-2 hover:ring-accent/30">
                <DocIcon kind={hit.kind} mimeType={hit.mimeType} title={hit.title} emoji={hit.icon} pageType={hit.pageType} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-semibold">{highlight(hit.title, term)}</span>
                    <StatusBadge status={hit.status} compact />
                  </span>
                  {hit.snippet && <span className="mt-0.5 line-clamp-2 block text-sm text-ink-2" dangerouslySetInnerHTML={{ __html: safeSnippet(hit.snippet) }} />}
                  <span className="mt-1 block text-meta text-ink-3">
                    {hit.spaceName} · {relativeTime(hit.updatedAt)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
      </ul>
    </div>
  );
}
