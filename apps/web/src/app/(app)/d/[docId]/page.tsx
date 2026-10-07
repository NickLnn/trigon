'use client';

import { isTextFile } from '@trigon/shared';
import { Download, Smile, Users } from 'lucide-react';
import dynamic from 'next/dynamic';
import { use, useEffect, useRef, useState } from 'react';
import type { ConnectionStatus } from '@/components/editor/collaborative-editor';
import { PageHeader } from '@/components/shell/page-header';
import { CustomIcon, fileFlavor } from '@/components/ui/doc-icon';
import { IconPicker } from '@/components/ui/icon-picker';
import { useDocument, useUpdateDocument } from '@/lib/queries';
import { useSession } from '@/lib/session';

// Heavy, browser-only modules load on demand.
const CollaborativeEditor = dynamic(() => import('@/components/editor/collaborative-editor').then((m) => m.CollaborativeEditor), { ssr: false });
const PdfViewer = dynamic(() => import('@/components/viewers/pdf-viewer').then((m) => m.PdfViewer), { ssr: false });
const DocxViewer = dynamic(() => import('@/components/viewers/docx-viewer').then((m) => m.DocxViewer), { ssr: false });
const XlsxViewer = dynamic(() => import('@/components/viewers/xlsx-viewer').then((m) => m.XlsxViewer), { ssr: false });
const PptxViewer = dynamic(() => import('@/components/viewers/pptx-viewer').then((m) => m.PptxViewer), { ssr: false });
const CodeFileEditor = dynamic(() => import('@/components/viewers/code-file-editor').then((m) => m.CodeFileEditor), { ssr: false });

/** Page icon above the title: click to pick a logo / emoji. */
function PageIcon({ id, icon, editable }: { id: string; icon: string | null; editable: boolean }) {
  const update = useUpdateDocument(id);
  const [open, setOpen] = useState(false);
  if (!editable && !icon) return null;
  return (
    <>
      {icon ? (
        <button onClick={() => editable && setOpen(true)} className="press mb-2 inline-block rounded-[1.25rem]" aria-label="Change icon">
          <CustomIcon icon={icon} size="xl" />
        </button>
      ) : (
        <button onClick={() => setOpen(true)} className="mb-1 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-ink-3 hover:bg-surface-2 hover:text-ink">
          <Smile className="size-4" /> Add icon
        </button>
      )}
      <IconPicker open={open} onOpenChange={setOpen} current={icon} onSelect={(v) => update.mutate({ icon: v ?? '' })} />
    </>
  );
}

function StatusPill({ status, peers }: { status: ConnectionStatus; peers: number }) {
  const dot = status === 'connected' ? 'bg-success' : status === 'connecting' ? 'bg-warning animate-pulse' : 'bg-danger';
  return (
    <span className="flex items-center gap-1.5 rounded-pill bg-surface px-3 py-1.5 text-meta font-medium shadow-card">
      <span className={`size-2 rounded-full ${dot}`} />
      {status === 'connected' ? (
        peers > 1 ? (
          <>
            <Users className="size-3.5" /> {peers}
          </>
        ) : (
          'Live'
        )
      ) : status === 'connecting' ? (
        'Connecting'
      ) : (
        'Offline'
      )}
    </span>
  );
}

function TitleInput({ id, title, editable }: { id: string; title: string; editable: boolean }) {
  const update = useUpdateDocument(id);
  const [value, setValue] = useState(title);
  const saved = useRef(title);
  useEffect(() => {
    setValue(title);
    saved.current = title;
  }, [title]);

  const commit = () => {
    const next = value.trim() || 'Untitled';
    if (next !== saved.current) {
      saved.current = next;
      update.mutate({ title: next });
    }
  };

  return (
    <textarea
      value={value}
      readOnly={!editable}
      rows={1}
      onChange={(e) => setValue(e.target.value.replace(/\n/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
      placeholder="Untitled"
      className="field-sizing-content w-full resize-none bg-transparent text-display font-bold outline-none placeholder:text-ink-3"
      aria-label="Page title"
    />
  );
}

export default function DocumentPage({ params }: { params: Promise<{ docId: string }> }) {
  const { docId } = use(params);
  const { user } = useSession();
  const { data: doc, error, isPending } = useDocument(docId);
  const [status, setStatus] = useState<{ s: ConnectionStatus; peers: number }>({ s: 'connecting', peers: 1 });

  if (error) return <p className="p-10 text-center text-ink-2">{error.message}</p>;
  if (isPending || !doc || !user) return <div className="mx-auto mt-24 h-8 w-2/3 max-w-xl animate-pulse rounded-lg bg-surface-2" />;

  const canEdit = doc.myPermission === 'edit' || doc.myPermission === 'manage';
  const contentUrl = `/files/${doc.id}/content`;

  if (doc.kind === 'file') {
    const flavor = fileFlavor(doc.mimeType, doc.title);
    return (
      <div className="flex h-[calc(100dvh-4.25rem-env(safe-area-inset-bottom))] flex-col md:h-dvh">
        <div className="glass sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line px-4 pt-safe">
          <h1 className="min-w-0 flex-1 truncate font-semibold">{doc.title}</h1>
          <a href={`/api${contentUrl}`} download={doc.title} className="press grid size-9 place-items-center rounded-full hover:bg-surface-2" aria-label="Download">
            <Download className="size-5" />
          </a>
        </div>
        <div className="min-h-0 flex-1">
          {flavor === 'pdf' && <PdfViewer fileUrl={contentUrl} />}
          {flavor === 'docx' && <DocxViewer fileUrl={contentUrl} />}
          {flavor === 'xlsx' && <XlsxViewer fileUrl={contentUrl} />}
          {flavor === 'pptx' && <PptxViewer fileUrl={contentUrl} />}
          {flavor === 'vsdx' && (
            <div className="grid h-full place-items-center p-8 text-center text-ink-2">
              <div className="max-w-sm">
                <p className="font-semibold text-ink">Visio diagrams can&apos;t be previewed in the browser yet.</p>
                <p className="mt-1 text-sm">Download it to open in Visio, or export the diagram as PDF/PNG and upload that for in-app viewing.</p>
                <a href={`/api${contentUrl}`} download={doc.title} className="mt-4 inline-block rounded-pill bg-accent px-5 py-3 font-semibold text-accent-ink">
                  Download
                </a>
              </div>
            </div>
          )}
          {flavor === 'file' && isTextFile(doc.title, doc.mimeType) && <CodeFileEditor documentId={doc.id} fileName={doc.title} editable={canEdit} />}
          {flavor === 'image' && (
            <div className="grid h-full place-items-center overflow-auto bg-surface-2 p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api${contentUrl}`} alt={doc.title} className="max-h-full rounded-xl shadow-card" />
            </div>
          )}
          {flavor === 'file' && !isTextFile(doc.title, doc.mimeType) && (
            <div className="grid h-full place-items-center p-8 text-center text-ink-2">
              <div>
                <p>No in-app preview for this file type.</p>
                <a href={`/api${contentUrl}`} download={doc.title} className="mt-4 inline-block rounded-pill bg-accent px-5 py-3 font-semibold text-accent-ink">
                  Download
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (doc.kind === 'folder') {
    return <p className="p-10 text-center text-ink-2">This is a folder — open it from its space.</p>;
  }

  return (
    <article>
      <PageHeader back title="" actions={<StatusPill status={status.s} peers={status.peers} />} />
      <div className="mx-auto max-w-3xl px-5 pb-32 md:px-10">
        <PageIcon id={doc.id} icon={doc.icon} editable={canEdit} />
        <TitleInput id={doc.id} title={doc.title} editable={canEdit} />
        {!canEdit && <p className="mb-2 text-meta text-ink-3">View only</p>}
        <div className="mt-4">
          <CollaborativeEditor
            documentId={doc.id}
            user={{ id: user.id, displayName: user.displayName }}
            editable={canEdit}
            initialHtml={doc.importHtml}
            onStatusChange={(s, peers) => setStatus({ s, peers })}
          />
        </div>
      </div>
    </article>
  );
}
