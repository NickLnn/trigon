'use client';

import { Search as SearchIcon, X } from 'lucide-react';
import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { DocIcon, relativeTime } from '@/components/ui/doc-icon';
import { useSearch } from '@/lib/queries';

/** Escape everything, then re-allow only the <mark> tags produced by ts_headline. */
function safeSnippet(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/&lt;mark&gt;/g, '<mark class="rounded bg-accent-soft px-0.5 text-accent">')
    .replace(/&lt;\/mark&gt;/g, '</mark>');
}

export default function SearchPage() {
  const [q, setQ] = useState('');
  const deferred = useDeferredValue(q);
  const { data, isFetching } = useSearch(deferred);

  return (
    <div className="mx-auto max-w-3xl px-4 pb-10 md:px-10">
      <div className="sticky top-0 z-10 -mx-4 bg-bg px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))] md:pt-8">
        <h1 className="mb-4 text-display font-bold">Search</h1>
        <label className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-3.5 shadow-card ring-accent focus-within:ring-2">
          <SearchIcon className={`size-5 ${isFetching ? 'animate-pulse text-accent' : 'text-ink-3'}`} />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Pages, files, spaces…"
            className="min-w-0 flex-1 bg-transparent text-[1rem] outline-none placeholder:text-ink-3"
            enterKeyHint="search"
            type="search"
          />
          {q && (
            <button onClick={() => setQ('')} aria-label="Clear" className="text-ink-3">
              <X className="size-5" />
            </button>
          )}
        </label>
      </div>

      {deferred.trim().length < 2 ? (
        <p className="mt-10 text-center text-ink-3">Search across every space you have access to.</p>
      ) : data?.length === 0 ? (
        <p className="mt-10 text-center text-ink-3">No results for “{deferred}”.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {data?.map((hit) => (
            <li key={hit.id}>
              <Link href={`/d/${hit.id}`} className="press flex gap-3 rounded-card bg-surface p-4 shadow-card">
                <DocIcon kind={hit.kind} title={hit.title} emoji={hit.icon} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{hit.title}</span>
                  {hit.snippet && (
                    <span className="mt-0.5 line-clamp-2 block text-sm text-ink-2" dangerouslySetInnerHTML={{ __html: safeSnippet(hit.snippet) }} />
                  )}
                  <span className="mt-1 block text-meta text-ink-3">
                    {hit.spaceName} · {relativeTime(hit.updatedAt)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
