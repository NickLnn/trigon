'use client';

import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileArchive, FolderOpen, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { importTree, readImportSource, type ImportEntry, type ImportProgress } from '@/lib/folder-import';
import { useSpaces } from '@/lib/queries';
import { BottomSheet } from './bottom-sheet';
import { SpaceIcon } from './doc-icon';

/**
 * Import a whole folder tree (Docmost export, Trigon export, or any folder of Markdown/HTML) as a
 * zip or picked folder. Merges into the chosen space/folder by title.
 */
export function ImportFolderSheet({
  open,
  onOpenChange,
  spaceId: initialSpace,
  parentId = null,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  spaceId: string;
  parentId?: string | null;
}) {
  const qc = useQueryClient();
  const { data: spaces } = useSpaces();
  const writable = spaces?.filter((s) => s.myPermission === 'edit' || s.myPermission === 'manage') ?? [];
  const [spaceId, setSpaceId] = useState(initialSpace);
  const [entries, setEntries] = useState<ImportEntry[] | null>(null);
  const [sourceName, setSourceName] = useState('');
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setEntries(null);
      setProgress(null);
      setError(null);
      setSpaceId(initialSpace);
    }
  }, [open, initialSpace]);

  useEffect(() => {
    // React doesn't know the non-standard folder-picker attributes.
    folderRef.current?.setAttribute('webkitdirectory', '');
    folderRef.current?.setAttribute('directory', '');
  });

  const pick = async (files: File[], name: string) => {
    setError(null);
    try {
      const e = await readImportSource(files);
      if (!e.some((x) => /\.(md|markdown|html?)$/i.test(x.path))) throw new Error('No Markdown or HTML pages found in that selection.');
      setEntries(e);
      setSourceName(name);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const start = async () => {
    if (!entries) return;
    setRunning(true);
    setError(null);
    try {
      await importTree(entries, { spaceId, parentId: spaceId === initialSpace ? parentId : null }, setProgress);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
      qc.invalidateQueries({ queryKey: ['tree'] });
      qc.invalidateQueries({ queryKey: ['recent'] });
      qc.invalidateQueries({ queryKey: ['health'] });
      qc.invalidateQueries({ queryKey: ['space-stats'] });
    }
  };

  const pages = entries?.filter((e) => /\.(md|markdown|html?)$/i.test(e.path)).length ?? 0;
  const attachments = (entries?.length ?? 0) - pages - (entries?.some((e) => /metadata\.json$/.test(e.path)) ? 1 : 0);
  const isDocmost = entries?.some((e) => e.path === 'docmost-metadata.json');
  const done = progress && !running;
  const pct = progress?.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <BottomSheet
      open={open}
      onOpenChange={(v) => !running && onOpenChange(v)}
      title="Import folder"
      description="A Docmost export, a Trigon export, or any folder of Markdown pages. Folders and sub-pages are kept; items that already exist are merged, not duplicated."
    >
      <div className="space-y-4">
        {writable.length > 1 && !progress && (
          <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {writable.map((s) => (
              <button
                key={s.id}
                onClick={() => setSpaceId(s.id)}
                className={`press flex shrink-0 items-center gap-2 rounded-pill py-1.5 pl-1.5 pr-3 text-sm font-semibold ${spaceId === s.id ? 'bg-navy text-white' : 'bg-surface-2 text-ink-2'}`}
              >
                <SpaceIcon space={s} size="sm" />
                {s.name}
              </button>
            ))}
          </div>
        )}

        {!entries && (
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => zipRef.current?.click()} className="press rounded-2xl border border-line p-4 text-left hover:bg-surface-2">
              <FileArchive className="size-6 text-accent" />
              <span className="mt-2 block font-semibold">Choose .zip</span>
              <span className="block text-meta text-ink-3">As downloaded from Docmost</span>
            </button>
            <button onClick={() => folderRef.current?.click()} className="press rounded-2xl border border-line p-4 text-left hover:bg-surface-2">
              <FolderOpen className="size-6 text-accent" />
              <span className="mt-2 block font-semibold">Choose folder</span>
              <span className="block text-meta text-ink-3">An unzipped export</span>
            </button>
          </div>
        )}

        {entries && !progress && (
          <div className="rounded-2xl bg-surface-2 p-4 text-sm">
            <p className="font-semibold">{sourceName}</p>
            <p className="mt-1 text-ink-2">
              {pages} pages · {attachments} attachments{isDocmost ? ' · Docmost export (icons and order kept)' : ''}
            </p>
            <p className="mt-2 text-meta text-ink-3">
              Into {writable.find((s) => s.id === spaceId)?.name ?? 'this space'}
              {parentId && spaceId === initialSpace ? ' (this folder)' : ' (top level)'}. Top-level items with the same name as existing ones — like
              “Microsoft” — are merged into them.
            </p>
          </div>
        )}

        {progress && (
          <div className="space-y-2">
            <div className="h-2 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
            </div>
            <p className="flex items-center gap-2 text-sm text-ink-2">
              {running ? <Loader2 className="size-4 animate-spin text-accent" /> : <CheckCircle2 className="size-4 text-success" />}
              {running ? `Importing ${progress.done}/${progress.total} — ${progress.current}` : 'Import finished'}
            </p>
            <p className="text-meta text-ink-3">
              {progress.created} created · {progress.merged} merged into existing · {progress.skipped} already there (skipped) · {progress.uploads} files uploaded
            </p>
            {progress.errors.length > 0 && (
              <details className="rounded-xl bg-danger/10 p-3 text-sm text-danger" open={done ?? false}>
                <summary className="cursor-pointer font-semibold">{progress.errors.length} problems</summary>
                <ul className="mt-2 space-y-1 text-meta">
                  {progress.errors.slice(0, 50).map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        {error && <p className="rounded-xl bg-danger/10 px-3.5 py-2.5 text-sm text-danger">{error}</p>}

        <div className="flex gap-2">
          {entries && !progress && (
            <>
              <button onClick={() => setEntries(null)} className="press flex-1 rounded-pill bg-surface-2 py-3 font-semibold">
                Back
              </button>
              <button onClick={start} className="press flex-1 rounded-pill bg-accent py-3 font-semibold text-accent-ink">
                Import {pages} pages
              </button>
            </>
          )}
          {done && (
            <button onClick={() => onOpenChange(false)} className="press flex-1 rounded-pill bg-accent py-3 font-semibold text-accent-ink">
              Done
            </button>
          )}
        </div>
        <p className="text-meta text-ink-3">Imported pages are filled in the first time someone opens them; search finds them straight away.</p>
      </div>

      <input
        ref={zipRef}
        type="file"
        hidden
        accept=".zip,application/zip"
        onChange={(e) => {
          const f = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (f.length) pick(f, f[0].name);
        }}
      />
      <input
        ref={folderRef}
        type="file"
        hidden
        multiple
        onChange={(e) => {
          const f = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (f.length) pick(f, ((f[0] as File & { webkitRelativePath?: string }).webkitRelativePath || f[0].name).split('/')[0]);
        }}
      />
    </BottomSheet>
  );
}
