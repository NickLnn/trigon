'use client';

import { FolderPlus, NotebookPen, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef } from 'react';
import { useCreateDocument, useUploadFile } from '@/lib/queries';
import { BottomSheet, SheetAction } from './bottom-sheet';

/** The "+" action sheet: new page, new folder, or upload a Word/PDF/any file into a space. */
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
  const create = useCreateDocument();
  const upload = useUploadFile();
  const fileRef = useRef<HTMLInputElement>(null);

  const newPage = async () => {
    const doc = await create.mutateAsync({ spaceId, parentId, kind: 'page' });
    onOpenChange(false);
    router.push(`/d/${doc.id}`);
  };
  const newFolder = async () => {
    const title = prompt('Folder name', 'New folder');
    if (!title) return;
    await create.mutateAsync({ spaceId, parentId, kind: 'folder', title });
    onOpenChange(false);
  };

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title="Create">
      <div className="space-y-1">
        <SheetAction icon={<NotebookPen className="size-5" />} label="Page" hint="Collaborative rich-text page" onClick={newPage} />
        <SheetAction icon={<FolderPlus className="size-5" />} label="Folder" hint="Group pages and files" onClick={newFolder} />
        <SheetAction icon={<Upload className="size-5" />} label="Upload file" hint="Word, PDF, images — viewable in-app" onClick={() => fileRef.current?.click()} />
      </div>
      <input
        ref={fileRef}
        type="file"
        hidden
        accept=".docx,.pdf,image/*,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf,*/*"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const doc = await upload.mutateAsync({ spaceId, parentId, file });
          e.target.value = '';
          onOpenChange(false);
          router.push(`/d/${doc.id}`);
        }}
      />
      {(create.isPending || upload.isPending) && <p className="mt-3 text-center text-meta text-ink-3">Working…</p>}
      {(create.error || upload.error) && <p className="mt-3 text-center text-meta text-danger">{(create.error ?? upload.error)?.message}</p>}
    </BottomSheet>
  );
}
