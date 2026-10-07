'use client';

/* eslint-disable @next/next/no-img-element */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IconCatalogEntry, IconInfo } from '@trigon/shared';
import { Globe, Loader2, Search, Trash2, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { BottomSheet } from './bottom-sheet';

const EMOJI = ['📘', '📗', '📕', '📒', '📁', '🗂️', '🛠️', '⚙️', '🔧', '🧰', '🖥️', '💻', '🗄️', '🌐', '🔐', '🛡️', '🔑', '☁️', '🚀', '📊', '📈', '🧪', '🐛', '📦', '🔌', '📡', '🧭', '📝', '✅', '⚠️', '🔥', '💡', '🏢', '👥', '🎯', '📌'];

type Tab = 'brands' | 'emoji' | 'upload';

/**
 * Pick an icon for a space, folder or page: original vendor favicons (curated tech catalogue or any
 * website), an uploaded image, or an emoji. Calls onSelect with the icon value (`img:<id>`, emoji, or null).
 */
export function IconPicker({
  open,
  onOpenChange,
  onSelect,
  current,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSelect: (icon: string | null) => void;
  current?: string | null;
}) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('brands');
  const [q, setQ] = useState('');
  const warmed = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const catalog = useQuery({
    queryKey: ['icon-catalog'],
    queryFn: () => api<IconCatalogEntry[]>('/icons/catalog'),
    enabled: open,
    // Poll while vendor icons are still being fetched in the background.
    refetchInterval: (query) => (query.state.data?.some((c) => !c.iconId) ? 2500 : false),
  });
  const custom = useQuery({ queryKey: ['icons'], queryFn: () => api<IconInfo[]>('/icons'), enabled: open });

  useEffect(() => {
    if (open && catalog.data?.some((c) => !c.iconId) && !warmed.current) {
      warmed.current = true;
      api('/icons/catalog/warm', { method: 'POST' }).catch(() => undefined);
    }
  }, [open, catalog.data]);

  const fetchSite = useMutation({
    mutationFn: (domain: string) => api<{ id: string }>('/icons/fetch', { method: 'POST', json: { domain } }),
    onSuccess: ({ id }) => {
      qc.invalidateQueries({ queryKey: ['icons'] });
      choose(`img:${id}`);
    },
  });
  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api<{ id: string }>('/icons/upload', { method: 'POST', body: form });
    },
    onSuccess: ({ id }) => {
      qc.invalidateQueries({ queryKey: ['icons'] });
      choose(`img:${id}`);
    },
  });

  const choose = (icon: string | null) => {
    onSelect(icon);
    onOpenChange(false);
  };

  const term = q.trim().toLowerCase();
  const looksLikeDomain = /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(q.trim().replace(/^https?:\/\//, ''));
  const groups = useMemo(() => {
    const items = (catalog.data ?? []).filter((c) => !term || c.name.toLowerCase().includes(term) || c.domain.includes(term));
    const map = new Map<string, IconCatalogEntry[]>();
    for (const i of items) map.set(i.category, [...(map.get(i.category) ?? []), i]);
    return [...map.entries()];
  }, [catalog.data, term]);
  const customItems = (custom.data ?? []).filter((c) => !term || c.name.toLowerCase().includes(term) || c.domain?.includes(term));

  const tile = (key: string, label: string, iconId: string | null, onClick: () => void, selected: boolean) => (
    <button
      key={key}
      onClick={onClick}
      disabled={!iconId}
      title={label}
      className={`press flex flex-col items-center gap-1.5 rounded-2xl p-2 hover:bg-surface-2 disabled:cursor-wait ${selected ? 'bg-accent-soft ring-2 ring-accent' : ''}`}
    >
      <span className="grid size-11 place-items-center rounded-xl bg-white ring-1 ring-line">
        {iconId ? <img src={`/api/icons/${iconId}`} alt="" className="size-7 object-contain" loading="lazy" /> : <Loader2 className="size-4 animate-spin text-ink-3" />}
      </span>
      <span className="line-clamp-1 w-full text-center text-[0.6875rem] font-medium text-ink-2">{label}</span>
    </button>
  );

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title="Choose icon">
      <div className="mb-4 flex rounded-pill bg-surface-2 p-1 text-sm font-semibold">
        {(['brands', 'emoji', 'upload'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`flex-1 rounded-pill py-2 capitalize ${tab === t ? 'bg-surface shadow-card' : 'text-ink-3'}`}>
            {t === 'brands' ? 'Logos' : t}
          </button>
        ))}
      </div>

      {tab === 'brands' && (
        <div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (looksLikeDomain) fetchSite.mutate(q.trim());
            }}
            className="flex gap-2"
          >
            <label className="flex flex-1 items-center gap-2 rounded-xl bg-surface-2 px-3 ring-accent focus-within:ring-2">
              <Search className="size-4 text-ink-3" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search, or type a website (e.g. veeam.com)" className="min-w-0 flex-1 bg-transparent py-2.5 outline-none" autoFocus />
            </label>
            {looksLikeDomain && (
              <button className="press inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 text-sm font-semibold text-accent-ink" disabled={fetchSite.isPending}>
                {fetchSite.isPending ? <Loader2 className="size-4 animate-spin" /> : <Globe className="size-4" />} Get logo
              </button>
            )}
          </form>
          {fetchSite.error && <p className="mt-2 text-sm text-danger">{fetchSite.error.message}</p>}

          <div className="mt-4 max-h-[50dvh] space-y-4 overflow-y-auto pr-1">
            {!!customItems.length && (
              <section>
                <h3 className="mb-1.5 text-meta font-semibold uppercase tracking-wider text-ink-3">Added by your team</h3>
                <div className="grid grid-cols-4 gap-1 sm:grid-cols-6">
                  {customItems.map((c) => tile(c.id, c.name, c.id, () => choose(`img:${c.id}`), current === `img:${c.id}`))}
                </div>
              </section>
            )}
            {groups.map(([category, items]) => (
              <section key={category}>
                <h3 className="mb-1.5 text-meta font-semibold uppercase tracking-wider text-ink-3">{category}</h3>
                <div className="grid grid-cols-4 gap-1 sm:grid-cols-6">
                  {items.map((c) => tile(c.domain, c.name, c.iconId, () => c.iconId && choose(`img:${c.iconId}`), current === `img:${c.iconId}`))}
                </div>
              </section>
            ))}
            {!groups.length && !customItems.length && (
              <p className="py-6 text-center text-sm text-ink-3">{looksLikeDomain ? 'Press “Get logo” to fetch it from the website.' : 'No match — type a website address to fetch its logo.'}</p>
            )}
          </div>
        </div>
      )}

      {tab === 'emoji' && (
        <div className="grid grid-cols-6 gap-1 sm:grid-cols-9">
          {EMOJI.map((e) => (
            <button key={e} onClick={() => choose(e)} className={`press grid aspect-square place-items-center rounded-xl text-2xl hover:bg-surface-2 ${current === e ? 'bg-accent-soft ring-2 ring-accent' : ''}`}>
              {e}
            </button>
          ))}
        </div>
      )}

      {tab === 'upload' && (
        <div className="rounded-2xl border-2 border-dashed border-line p-8 text-center">
          <Upload className="mx-auto size-7 text-ink-3" />
          <p className="mt-2 font-semibold">Upload an image</p>
          <p className="text-sm text-ink-3">SVG or square PNG works best · max 1 MB</p>
          <button onClick={() => fileRef.current?.click()} className="press mt-4 rounded-pill bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink" disabled={upload.isPending}>
            {upload.isPending ? 'Uploading…' : 'Choose file'}
          </button>
          {upload.error && <p className="mt-2 text-sm text-danger">{upload.error.message}</p>}
          <input
            ref={fileRef}
            type="file"
            hidden
            accept="image/png,image/svg+xml,image/x-icon,image/webp,image/jpeg,.ico"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) upload.mutate(f);
            }}
          />
        </div>
      )}

      {current && (
        <button onClick={() => choose(null)} className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-ink-3 hover:text-danger">
          <Trash2 className="size-4" /> Remove icon
        </button>
      )}
    </BottomSheet>
  );
}
