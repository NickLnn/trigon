'use client';

import type { DocumentNode } from '@trigon/shared';
import { CheckCircle2, FileCode2, FileText, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { download, exportTree, type ExportFormat, type ExportProgress } from '@/lib/export';
import { useTree } from '@/lib/queries';
import { BottomSheet } from './bottom-sheet';

/**
 * Export a page/folder/file (node) or a whole space (node = null) as Markdown or HTML, optionally
 * with sub-pages and attachments. Markdown exports re-import into any Trigon via "Import folder".
 */
export function ExportSheet({
  open,
  onOpenChange,
  spaceId,
  node,
  name,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  spaceId: string;
  node: DocumentNode | null;
  name: string;
}) {
  const { data: tree } = useTree(spaceId);
  const [format, setFormat] = useState<ExportFormat>('markdown');
  const [subpages, setSubpages] = useState(true);
  const [attachments, setAttachments] = useState(true);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    if (open) {
      setProgress(null);
      setError(null);
      setFinished(false);
    }
  }, [open]);

  // The tree node carries the children; the passed node may be a shallow copy.
  const find = (list: DocumentNode[], id: string): DocumentNode | null => {
    for (const n of list) {
      if (n.id === id) return n;
      const inner = find(n.children ?? [], id);
      if (inner) return inner;
    }
    return null;
  };
  const roots = node ? [tree ? (find(tree, node.id) ?? node) : node] : (tree ?? []);
  const hasChildren = !node || !!roots[0]?.children?.length;

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const { blob, filename } = await exportTree(roots, { format, subpages: subpages && hasChildren, attachments }, { name }, setProgress);
      download(blob, filename);
      setFinished(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const Option = ({ value, icon: Icon, title, hint }: { value: ExportFormat; icon: typeof FileText; title: string; hint: string }) => (
    <button
      onClick={() => setFormat(value)}
      className={`press rounded-2xl border p-3 text-left ${format === value ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface-2'}`}
    >
      <Icon className={`size-5 ${format === value ? 'text-accent' : 'text-ink-3'}`} />
      <span className="mt-2 block text-sm font-semibold">{title}</span>
      <span className="block text-meta text-ink-3">{hint}</span>
    </button>
  );

  const Check = ({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string; disabled?: boolean }) => (
    <label className={`flex items-start gap-3 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-1 size-4 accent-[var(--accent)]" />
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-meta text-ink-3">{hint}</span>
      </span>
    </label>
  );

  return (
    <BottomSheet open={open} onOpenChange={(v) => !running && onOpenChange(v)} title={`Export “${name}”`}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <Option value="markdown" icon={FileText} title="Markdown" hint="Re-importable into another Trigon (or Docmost)" />
          <Option value="html" icon={FileCode2} title="HTML" hint="Readable in any browser, with a contents page" />
        </div>
        <div className="space-y-3 rounded-2xl bg-surface-2 p-4">
          <Check checked={subpages && hasChildren} disabled={!hasChildren} onChange={setSubpages} label="Include all sub-pages" hint="Everything inside, keeping the folder structure" />
          <Check checked={attachments} onChange={setAttachments} label="Include attachments and files" hint="Images in pages, plus uploaded PDFs, Office files, scripts…" />
        </div>

        {progress && (
          <div className="space-y-1.5">
            <div className="h-2 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} />
            </div>
            <p className="flex items-center gap-2 text-sm text-ink-2">
              {running ? <Loader2 className="size-4 animate-spin text-accent" /> : <CheckCircle2 className="size-4 text-success" />}
              {running ? `${progress.done}/${progress.total} — ${progress.current}` : 'Download started'}
            </p>
          </div>
        )}
        {error && <p className="rounded-xl bg-danger/10 px-3.5 py-2.5 text-sm text-danger">{error}</p>}

        <button onClick={finished ? () => onOpenChange(false) : run} disabled={running} className="press w-full rounded-pill bg-accent py-3 font-semibold text-accent-ink disabled:opacity-60">
          {running ? 'Exporting…' : finished ? 'Done' : 'Export and download'}
        </button>
      </div>
    </BottomSheet>
  );
}
