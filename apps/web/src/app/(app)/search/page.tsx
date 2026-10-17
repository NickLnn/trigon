'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { SEARCH_SINCE_DAYS } from '@trigon/shared';
import { FileText, Image as ImageIcon, Loader2, ScanText, Search as SearchIcon, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DocIcon, relativeTime } from '@/components/ui/doc-icon';
import { StatusBadge } from '@/components/ui/status-badge';
import { api, ApiError } from '@/lib/api';
import { useSpaces, type SearchHit } from '@/lib/queries';

/** Escape everything, then re-allow only the <mark> tags the server puts around matched words. */
function safeSnippet(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/&lt;mark&gt;/g, '<mark class="rounded bg-accent-soft px-0.5 text-accent">')
    .replace(/&lt;\/mark&gt;/g, '</mark>');
}

/** Same folding as the server: case, accents and final sigma don't matter ("αθηνα" marks "Αθήνα"). */
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/ς/g, 'σ');

/** Highlight the typed words inside a title. */
function highlight(title: string, q: string) {
  const words = fold(q).match(/[\p{L}\p{N}]+/gu);
  if (!words?.length) return title;
  // Fold per character so a match in the folded title maps back to the original characters.
  const chars = Array.from(title);
  const starts: number[] = [];
  let folded = '';
  for (const ch of chars) {
    starts.push(folded.length);
    folded += fold(ch);
  }
  const marked = new Array<boolean>(chars.length).fill(false);
  for (const w of words) {
    for (let at = folded.indexOf(w); at >= 0; at = folded.indexOf(w, at + 1)) {
      chars.forEach((_, i) => {
        if (starts[i] >= at && starts[i] < at + w.length) marked[i] = true;
      });
    }
  }
  const parts: { text: string; mark: boolean }[] = [];
  chars.forEach((ch, i) => {
    const last = parts[parts.length - 1];
    if (last && last.mark === marked[i]) last.text += ch;
    else parts.push({ text: ch, mark: marked[i] });
  });
  return parts.map((p, i) =>
    p.mark ? (
      <mark key={i} className="rounded bg-accent-soft px-0.5 text-accent">
        {p.text}
      </mark>
    ) : (
      p.text
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

type TypeFilter = '' | 'page' | 'file';
type SinceFilter = '' | `${(typeof SEARCH_SINCE_DAYS)[number]}`;

const SINCE_LABEL: Record<(typeof SEARCH_SINCE_DAYS)[number], string> = { 7: 'Past week', 30: 'Past month', 365: 'Past year' };

/** Where the words were found, when it isn't obvious from the excerpt. */
function foundLabel(hit: SearchHit) {
  const parts: string[] = [];
  if (hit.foundIn === 'scan') parts.push('Found in scanned text');
  if (hit.foundIn === 'image') parts.push('Found in an image on this page');
  if (hit.page) parts.push(`page ${hit.page}`);
  return parts.join(' · ');
}

/** Open a PDF at the page of the match with the words highlighted; anything else as usual. */
function hitHref(hit: SearchHit, term: string) {
  return hit.page ? `/d/${hit.id}?page=${hit.page}&q=${encodeURIComponent(term)}` : `/d/${hit.id}`;
}

function FilterSelect<T extends string>({ value, onChange, label, children }: { value: T; onChange: (v: T) => void; label: string; children: ReactNode }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      aria-label={label}
      className={`press h-8 max-w-44 shrink-0 cursor-pointer truncate rounded-pill border px-3 text-meta font-semibold outline-none ring-accent focus-visible:ring-2 ${
        value ? 'border-transparent bg-accent-soft text-accent' : 'border-line bg-surface text-ink-2'
      }`}
    >
      {children}
    </select>
  );
}

export default function SearchPage() {
  const [q, setQ] = useState('');
  const [type, setType] = useState<TypeFilter>('');
  const [space, setSpace] = useState('');
  const [since, setSince] = useState<SinceFilter>('');
  const term = useDebounced(q.trim(), 180);
  const inputRef = useRef<HTMLInputElement>(null);
  const spaces = useSpaces();
  const params = new URLSearchParams({ q: term });
  if (type) params.set('type', type);
  if (space) params.set('space', space);
  if (since) params.set('since', since);
  const filtered = !!(type || space || since);
  const results = useQuery({
    queryKey: ['search', term, type, space, since],
    queryFn: () => api<SearchHit[]>(`/documents/search?${params}`),
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
              if (e.key === 'Enter' && results.data?.[0]) location.assign(hitHref(results.data[0], term));
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
        <div className="-mx-1 mt-2.5 flex items-center gap-2 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">
          <FilterSelect value={type} onChange={setType} label="Type">
            <option value="">Pages and files</option>
            <option value="page">Pages only</option>
            <option value="file">Files only</option>
          </FilterSelect>
          <FilterSelect value={space} onChange={setSpace} label="Space">
            <option value="">All spaces</option>
            {spaces.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect value={since} onChange={setSince} label="Changed">
            <option value="">Any time</option>
            {SEARCH_SINCE_DAYS.map((d) => (
              <option key={d} value={String(d)}>
                {SINCE_LABEL[d]}
              </option>
            ))}
          </FilterSelect>
          {filtered && (
            <button
              onClick={() => {
                setType('');
                setSpace('');
                setSince('');
              }}
              className="press h-8 shrink-0 rounded-pill px-2.5 text-meta font-semibold text-ink-3 hover:text-ink"
            >
              Clear filters
            </button>
          )}
        </div>
        <div className="mt-2 min-h-5 px-1 text-meta text-ink-3" aria-live="polite">
          {rateLimited
            ? 'You’re typing faster than search can keep up — results will catch up in a moment.'
            : results.error
              ? <span className="text-danger">Search failed: {results.error.message}</span>
              : !q
                ? 'Search across every space you have access to — including the text inside files, scans and screenshots.'
                : busy
                  ? 'Searching…'
                  : results.data
                    ? `${results.data.length}${results.data.length === 20 ? '+' : ''} result${results.data.length === 1 ? '' : 's'}${results.data.length ? ' — press Enter to open the first' : ''}`
                    : ''}
        </div>
      </div>

      {term && results.data?.length === 0 && !busy && (
        <p className="mt-8 text-center text-ink-3">
          No results for “{term}”{filtered ? ' with these filters' : ''}. Try {filtered ? 'clearing the filters, or ' : ''}fewer or shorter words.
        </p>
      )}

      <ul className={`mt-1 space-y-2 transition-opacity ${busy && results.data ? 'opacity-60' : ''}`}>
        {q &&
          results.data?.map((hit) => {
            const found = foundLabel(hit);
            return (
              <li key={hit.id}>
                <Link href={hitHref(hit, term)} className="press flex gap-3 rounded-card bg-surface p-4 shadow-card hover:ring-2 hover:ring-accent/30">
                  <DocIcon kind={hit.kind} mimeType={hit.mimeType} title={hit.title} emoji={hit.icon} pageType={hit.pageType} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-semibold">{highlight(hit.title, term)}</span>
                      <StatusBadge status={hit.status} compact />
                    </span>
                    {hit.snippet && <span className="mt-0.5 line-clamp-2 block text-sm text-ink-2" dangerouslySetInnerHTML={{ __html: safeSnippet(hit.snippet) }} />}
                    <span className="mt-1 flex flex-wrap items-center gap-x-1.5 text-meta text-ink-3">
                      <span>
                        {hit.spaceName} · {relativeTime(hit.updatedAt)}
                      </span>
                      {found && (
                        <span className="inline-flex items-center gap-1 text-accent">
                          {hit.foundIn === 'image' ? <ImageIcon className="size-3.5" /> : hit.foundIn === 'scan' ? <ScanText className="size-3.5" /> : <FileText className="size-3.5" />}
                          {found}
                        </span>
                      )}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
      </ul>
    </div>
  );
}
