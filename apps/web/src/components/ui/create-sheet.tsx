'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FileDown, FolderPlus, Loader2, NotebookPen, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { IMPORT_ACCEPT, importFiles } from '@/lib/importer';
import { useCreateDocument, useUploadFile } from '@/lib/queries';
import { BottomSheet, SheetAction } from './bottom-sheet';

type Step = 'menu' | 'folder';

/** The "+" action sheet: new page, new folder, upload files, or import Markdown/HTML. */
export function CreateSheet({
  open,
  onOpenChange,
  spaceId,
  parentId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  spaceId: string;
  parentId?: string | null;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const create = useCreateDocument();
  const upload = useUploadFile();
  const fileRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>('menu');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStep('menu');
      setError(null);
    }
  }, [open]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const newPage = () =>
    run('Creating page…', async () => {
      const doc = await create.mutateAsync({ spaceId, parentId, kind: 'page' });
      onOpenChange(false);
      router.push(`/d/${doc.id}`);
    });

  const newFolder = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const title = String(new FormData(e.currentTarget).get('title') || '').trim() || 'New folder';
    run('Creating folder…', async () => {
      await create.mutateAsync({ spaceId, parentId, kind: 'folder', title });
      onOpenChange(false);
    });
  };

  const uploadFiles = (files: File[]) =>
    run(files.length > 1 ? `Uploading ${files.length} files…` : 'Uploading…', async () => {
      let last: { id: string } | undefined;
      for (const file of files) last = await upload.mutateAsync({ spaceId, parentId, file });
      onOpenChange(false);
      if (files.length === 1 && last) router.push(`/d/${last.id}`);
    });

  const importDocs = (files: File[]) =>
    run(files.length > 1 ? `Importing ${files.length} files…` : 'Importing…', async () => {
      const created = await importFiles(files, { spaceId, parentId });
      qc.invalidateQueries({ queryKey: ['tree', spaceId] });
      qc.invalidateQueries({ queryKey: ['recent'] });
      onOpenChange(false);
      if (created.length === 1) router.push(`/d/${created[0].id}`);
    });

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title={step === 'folder' ? 'New folder' : 'Create'}>
      {step === 'menu' ? (
        <div className="space-y-1">
          <SheetAction icon={<NotebookPen className="size-5" />} label="Page" hint="Collaborative rich-text page" onClick={newPage} />
          <SheetAction icon={<FolderPlus className="size-5" />} label="Folder" hint="Group pages and files" onClick={() => setStep('folder')} />
          <SheetAction icon={<Upload className="size-5" />} label="Upload files" hint="Word, PDF, images — viewable in-app" onClick={() => fileRef.current?.click()} />
          <SheetAction icon={<FileDown className="size-5" />} label="Import Markdown or HTML" hint="Turn .md / .html files into editable pages" onClick={() => importRef.current?.click()} />
        </div>
      ) : (
        <form onSubmit={newFolder} className="space-y-4">
          <input
            name="title"
            autoFocus
            defaultValue=""
            placeholder="Folder name"
            maxLength={255}
            className="w-full rounded-2xl bg-surface-2 px-4 py-3.5 text-[1rem] outline-none ring-accent focus:ring-2"
          />
          <div className="flex gap-2">
            <button type="button" onClick={() => setStep('menu')} className="press grid size-12 shrink-0 place-items-center rounded-full bg-surface-2" aria-label="Back">
              <ArrowLeft className="size-5" />
            </button>
            <button disabled={!!busy} className="press flex-1 rounded-pill bg-accent py-3 font-semibold text-accent-ink disabled:opacity-60">
              Create folder
            </button>
          </div>
        </form>
      )}

      <input
        ref={fileRef}
        type="file"
        hidden
        multiple
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) uploadFiles(files);
        }}
      />
      <input
        ref={importRef}
        type="file"
        hidden
        multiple
        accept={IMPORT_ACCEPT}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) importDocs(files);
        }}
      />
      {busy && (
        <p className="mt-3 flex items-center justify-center gap-2 text-meta text-ink-3">
          <Loader2 className="size-3.5 animate-spin" /> {busy}
        </p>
      )}
      {error && <p className="mt-3 text-center text-meta text-danger">{error}</p>}
    </BottomSheet>
  );
}
