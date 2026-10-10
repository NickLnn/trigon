'use client';

import { useQueryClient } from '@tanstack/react-query';
import type { PageType } from '@trigon/shared';
import { ArrowLeft, BookOpenText, FileDown, FolderInput, FolderPlus, ListChecks, Loader2, NotebookPen, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { IMPORT_ACCEPT, importFiles } from '@/lib/importer';
import { useCreateDocument, useSpaces, useUploadFile } from '@/lib/queries';
import { KB_TEMPLATE, RUNBOOK_TEMPLATE } from '@/lib/templates';
import { BottomSheet, SheetAction } from './bottom-sheet';
import { SpaceIcon } from './doc-icon';
import { ImportFolderSheet } from './import-folder-sheet';

type Step = 'menu' | 'folder';
/** Open straight into an action (quick actions on Home) instead of the menu. */
export type CreateStart = 'menu' | 'page' | 'runbook' | 'kb' | 'folder' | 'upload' | 'import';

/** The "+" sheet: page, runbook, KB article, folder, upload files, or import Markdown/HTML. */
export function CreateSheet({
  open,
  onOpenChange,
  spaceId: initialSpaceId,
  parentId,
  start = 'menu',
  chooseSpace = false,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  spaceId: string;
  parentId?: string | null;
  start?: CreateStart;
  /** Show a space picker (when not opened from inside a space). */
  chooseSpace?: boolean;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const create = useCreateDocument();
  const upload = useUploadFile();
  const { data: spaces } = useSpaces();
  const fileRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const [spaceId, setSpaceId] = useState(initialSpaceId);
  const [step, setStep] = useState<Step>('menu');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [folderImport, setFolderImport] = useState(false);
  const writable = spaces?.filter((s) => s.myPermission === 'edit' || s.myPermission === 'manage') ?? [];
  const autoStarted = useRef(false);

  useEffect(() => {
    if (!open) return;
    setStep(start === 'folder' ? 'folder' : 'menu');
    setError(null);
    autoStarted.current = false;
  }, [open, start]);

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

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['tree', spaceId] });
    qc.invalidateQueries({ queryKey: ['recent'] });
    qc.invalidateQueries({ queryKey: ['health'] });
  };

  const newPage = () =>
    run('Creating page…', async () => {
      const doc = await create.mutateAsync({ spaceId, parentId, kind: 'page' });
      onOpenChange(false);
      router.push(`/d/${doc.id}`);
    });

  const fromTemplate = (pageType: PageType, title: string, html: string) =>
    run(`Creating ${pageType === 'kb' ? 'article' : 'runbook'}…`, async () => {
      const doc = await api<{ id: string }>('/documents/import', {
        method: 'POST',
        json: { spaceId, parentId: parentId ?? undefined, title, html, pageType, status: 'draft' },
      });
      refresh();
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
      refresh();
      onOpenChange(false);
      if (created.length === 1) router.push(`/d/${created[0].id}`);
    });

  // Quick actions that don't need a choice go straight through (when the space is fixed).
  useEffect(() => {
    if (!open || autoStarted.current || chooseSpace) return;
    autoStarted.current = true;
    if (start === 'page') newPage();
    if (start === 'runbook') fromTemplate('runbook', 'New runbook', RUNBOOK_TEMPLATE);
    if (start === 'kb') fromTemplate('kb', 'New article', KB_TEMPLATE);
    if (start === 'upload') fileRef.current?.click();
    if (start === 'import') importRef.current?.click();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, start, chooseSpace]);

  const highlight = (key: CreateStart) => (chooseSpace && start === key ? 'ring-2 ring-accent rounded-2xl' : '');

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title={step === 'folder' ? 'New folder' : 'Create'}>
      {chooseSpace && writable.length > 1 && step === 'menu' && (
        <div className="no-scrollbar -mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1">
          {writable.map((s) => (
            <button
              key={s.id}
              onClick={() => setSpaceId(s.id)}
              className={`press flex shrink-0 items-center gap-2 rounded-pill py-1.5 pl-1.5 pr-3 text-sm font-semibold ${
                spaceId === s.id ? 'bg-navy text-white' : 'bg-surface-2 text-ink-2'
              }`}
            >
              <SpaceIcon space={s} size="sm" />
              {s.name}
            </button>
          ))}
        </div>
      )}

      {step === 'menu' ? (
        <div className="space-y-1">
          <div className={highlight('page')}>
            <SheetAction icon={<NotebookPen className="size-5" />} label="Page" hint="Free-form collaborative page" onClick={newPage} />
          </div>
          <div className={highlight('runbook')}>
            <SheetAction
              icon={<ListChecks className="size-5" />}
              label="Runbook"
              hint="Steps, warnings and copyable commands"
              onClick={() => fromTemplate('runbook', 'New runbook', RUNBOOK_TEMPLATE)}
            />
          </div>
          <SheetAction icon={<BookOpenText className="size-5" />} label="Knowledge-base article" hint="Symptoms, cause and resolution" onClick={() => fromTemplate('kb', 'New article', KB_TEMPLATE)} />
          <SheetAction icon={<FolderPlus className="size-5" />} label="Folder" hint="Group pages and files" onClick={() => setStep('folder')} />
          <div className={highlight('upload')}>
            <SheetAction icon={<Upload className="size-5" />} label="Upload files" hint="PDF, Office, images, scripts, configs" onClick={() => fileRef.current?.click()} />
          </div>
          <div className={highlight('import')}>
            <SheetAction icon={<FileDown className="size-5" />} label="Import Markdown or HTML" hint="Turn .md / .html files into editable pages" onClick={() => importRef.current?.click()} />
          </div>
          <SheetAction icon={<FolderInput className="size-5" />} label="Import folder or .zip" hint="Docmost / Trigon export with sub-pages and attachments" onClick={() => setFolderImport(true)} />
        </div>
      ) : (
        <form onSubmit={newFolder} className="space-y-4">
          <input
            name="title"
            autoFocus
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
      {folderImport && (
        <ImportFolderSheet
          open
          onOpenChange={(v) => {
            setFolderImport(v);
            if (!v) onOpenChange(false);
          }}
          spaceId={spaceId}
          parentId={parentId}
        />
      )}
    </BottomSheet>
  );
}
