'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SearchIndexStatus, SearchSettings } from '@trigon/shared';
import { AlertTriangle, ExternalLink, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, Button, Field, Result, SettingsCard, TextInput, Toggle } from '@/components/settings/ui';
import { api } from '@/lib/api';

const GUIDE = 'https://github.com/NickLnn/trigon/blob/main/docs/ocr-languages.md';

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-xl bg-surface-2 px-3.5 py-2.5">
      <div className="text-lg font-bold tabular-nums">{value.toLocaleString()}</div>
      <div className="text-meta text-ink-3">{label}</div>
    </div>
  );
}

export default function SearchSettingsPage() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['search-index'],
    queryFn: () => api<SearchIndexStatus>('/settings/search'),
    // Poll while files are being read, slowly otherwise.
    refetchInterval: (q) => (q.state.data && (q.state.data.counts.pending > 0 || q.state.data.current) ? 3000 : 30_000),
  });
  const [form, setForm] = useState<SearchSettings | null>(null);
  useEffect(() => {
    if (data && !form) setForm(data.settings);
  }, [data, form]);

  const save = useMutation({
    mutationFn: (value: SearchSettings) => api<SearchSettings>('/settings/search', { method: 'PUT', json: value }),
    onSuccess: (saved) => {
      setForm(saved);
      qc.invalidateQueries({ queryKey: ['search-index'] });
    },
  });
  const reindex = useMutation({
    mutationFn: (scope: 'all' | 'scans') => api<{ queued: number }>('/settings/search/reindex', { method: 'POST', json: { scope } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['search-index'] }),
  });

  if (!data || !form) return <div className="h-40 animate-pulse rounded-card bg-surface" />;

  const c = data.counts;
  const dirty = JSON.stringify(form) !== JSON.stringify(data.settings);
  const toggleLang = (code: string) =>
    setForm({ ...form, ocrLanguages: form.ocrLanguages.includes(code) ? form.ocrLanguages.filter((l) => l !== code) : [...form.ocrLanguages, code] });

  return (
    <div className="space-y-5">
      <SettingsCard
        title="Uploaded files in search"
        description="Trigon reads the text of uploaded PDFs, Word, Excel, PowerPoint, OpenDocument and text files so search finds what is inside them. Scanned pages and images are read with OCR."
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat value={c.text + c.ocr} label="Searchable" />
          <Stat value={c.ocr} label="Read with OCR" />
          <Stat value={c.pending} label="Waiting" />
          <Stat value={c.empty + c.unsupported + c.failed} label="No text found" />
        </div>
        {data.current && (
          <p className="mt-3 flex items-center gap-2 text-sm text-ink-2">
            <Loader2 className="size-4 shrink-0 animate-spin" />
            <span className="truncate">Reading “{data.current}”…</span>
          </p>
        )}
        {c.failed > 0 && <p className="mt-3 text-sm text-ink-2">{c.failed} file{c.failed === 1 ? '' : 's'} could not be read (damaged or password-protected).</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" busy={reindex.isPending && reindex.variables === 'scans'} onClick={() => reindex.mutate('scans')}>
            Read PDFs and images again
          </Button>
          <Button variant="secondary" busy={reindex.isPending && reindex.variables === 'all'} onClick={() => reindex.mutate('all')}>
            Read all files again
          </Button>
        </div>
        {reindex.data && <p className="mt-2 text-meta text-ink-3">{reindex.data.queued} files queued. They are read one at a time in the background.</p>}
      </SettingsCard>

      <SettingsCard title="OCR" description="Reads text from scanned PDFs and images (screenshots, photos of documents). Runs one file at a time at low priority.">
        {!data.ocrAvailable && (
          <div className="mb-4 flex gap-3 rounded-xl bg-warning/12 p-3.5 text-sm">
            <AlertTriangle className="size-5 shrink-0 text-warning" />
            <p>The OCR tools are not installed here. They come with the Trigon Docker image, so this is expected when running from source.</p>
          </div>
        )}
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(form);
          }}
        >
          <Toggle label="Read scans and images" hint="Text-based PDFs and Office files are always indexed." checked={form.ocrEnabled} onChange={(v) => setForm({ ...form, ocrEnabled: v })} />

          <div>
            <span className="mb-1.5 block text-sm font-semibold">Languages</span>
            <div className="space-y-1">
              {data.languages.map((l) => (
                <label key={l.code} className="flex cursor-pointer items-center gap-3 rounded-xl px-1 py-1.5">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--accent)]"
                    checked={form.ocrLanguages.includes(l.code)}
                    disabled={!form.ocrEnabled}
                    onChange={() => toggleLang(l.code)}
                  />
                  <span className="flex-1">
                    {l.name} <span className="text-meta text-ink-3">{l.code}</span>
                  </span>
                  <Badge tone={l.source === 'built-in' ? 'neutral' : 'accent'}>{l.source === 'built-in' ? 'Built in' : 'Added'}</Badge>
                </label>
              ))}
              {!data.languages.length && <p className="text-sm text-ink-3">No language files found.</p>}
            </div>
            <p className="mt-1.5 text-meta text-ink-3">Tick only the languages your documents use — each extra one makes OCR slower.</p>
          </div>

          <Field label="Pages per file" hint="Scanned pages read per PDF at most. Keeps very large scans from using the CPU for long.">
            <TextInput
              type="number"
              min={1}
              max={1000}
              value={form.ocrMaxPages}
              disabled={!form.ocrEnabled}
              onChange={(e) => setForm({ ...form, ocrMaxPages: Math.max(1, Number(e.target.value) || 1) })}
              className="max-w-32"
            />
          </Field>

          {save.error && <Result result={{ ok: false, message: save.error.message }} />}
          {save.isSuccess && !dirty && <Result result={{ ok: true, message: 'Saved. Use “Read PDFs and images again” to apply it to files already uploaded.' }} />}
          <Button type="submit" busy={save.isPending} disabled={!dirty}>
            Save
          </Button>
        </form>
      </SettingsCard>

      <SettingsCard title="Add a language" description="English and Greek are built in. Other languages are one file each, added to the server.">
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-ink-2">
          <li>
            Download <code className="rounded bg-surface-2 px-1">&lt;code&gt;.traineddata</code> from Tesseract&rsquo;s <b>tessdata_fast</b> collection (e.g.{' '}
            <code className="rounded bg-surface-2 px-1">deu.traineddata</code> for German).
          </li>
          <li>
            Put it in the <code className="rounded bg-surface-2 px-1">data/tessdata</code> folder next to Trigon&rsquo;s <code className="rounded bg-surface-2 px-1">docker-compose.yml</code>.
          </li>
          <li>Reload this page, tick the language, Save, then “Read PDFs and images again”.</li>
        </ol>
        <a href={GUIDE} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-accent">
          Step-by-step guide <ExternalLink className="size-3.5" />
        </a>
      </SettingsCard>
    </div>
  );
}
