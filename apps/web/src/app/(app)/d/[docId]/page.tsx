'use client';

import { isTextFile } from '@trigon/shared';
import { ArrowLeft, ChevronRight, Download, Info, Share2, Smile } from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConnectionStatus, OutlineItem, Peer } from '@/components/editor/collaborative-editor';
import { DocDetails, VerifyButton } from '@/components/shell/doc-details';
import { ShareSheet } from '@/components/shell/share-sheet';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { CustomIcon, fileFlavor, relativeTime } from '@/components/ui/doc-icon';
import { IconPicker } from '@/components/ui/icon-picker';
import { StatusBadge, TagChip } from '@/components/ui/status-badge';
import { findPath, useDocument, useSpace, useTree, useUpdateDocument, type DocumentDetail } from '@/lib/queries';
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
      className="field-sizing-content w-full resize-none bg-transparent text-[1.75rem] font-bold leading-tight tracking-tight outline-none placeholder:text-ink-3 md:text-display"
      aria-label="Page title"
    />
  );
}

/** Space › folder › … trail above the title. */
function Breadcrumb({ doc }: { doc: DocumentDetail }) {
  const { data: space } = useSpace(doc.spaceId);
  const { data: tree } = useTree(doc.spaceId);
  const trail = useMemo(() => (tree ? (findPath(tree, doc.id) ?? []).slice(0, -1) : []), [tree, doc.id]);
  return (
    <nav className="no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto whitespace-nowrap text-sm text-ink-3" aria-label="Breadcrumb">
      <Link href={`/spaces/${doc.spaceId}`} className="hover:text-ink">
        {space?.name ?? '…'}
      </Link>
      {trail.map((n) => (
        <span key={n.id} className="flex items-center gap-1">
          <ChevronRight className="size-3.5" />
          <span>{n.title}</span>
        </span>
      ))}
    </nav>
  );
}

function Presence({ status, peers }: { status: ConnectionStatus; peers: Peer[] }) {
  const dot = status === 'connected' ? 'bg-success' : status === 'connecting' ? 'bg-warning animate-pulse' : 'bg-danger';
  return (
    <div className="flex items-center gap-2">
      <div className="flex -space-x-1.5">
        {peers.slice(0, 5).map((p, i) => (
          <span
            key={`${p.name}-${i}`}
            title={p.name}
            className="grid size-7 place-items-center rounded-full border-2 border-surface text-[0.6875rem] font-bold text-white"
            style={{ background: p.color }}
          >
            {p.name
              .split(/\s+/)
              .map((x) => x[0])
              .slice(0, 2)
              .join('')
              .toUpperCase()}
          </span>
        ))}
      </div>
      <span className="flex items-center gap-1.5 text-meta font-medium text-ink-2">
        <span className={`size-2 rounded-full ${dot}`} />
        {status === 'connected' ? (peers.length > 1 ? `${peers.length} live` : 'Live') : status === 'connecting' ? 'Connecting' : 'Offline'}
      </span>
    </div>
  );
}

function Outline({ items }: { items: OutlineItem[] }) {
  if (!items.length) return null;
  const jump = (i: number) => document.querySelectorAll('.trigon-prose h1, .trigon-prose h2, .trigon-prose h3, .trigon-prose h4')[i]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <section>
      <h3 className="mb-1.5 text-meta font-semibold uppercase tracking-wider text-ink-3">On this page</h3>
      <ul className="space-y-0.5">
        {items.map((h, i) => (
          <li key={`${h.text}-${i}`}>
            <button onClick={() => jump(i)} className="w-full truncate rounded-md py-1 text-left text-sm text-ink-2 hover:text-accent" style={{ paddingLeft: (h.level - 1) * 10 }}>
              {h.text}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function DocumentPage({ params }: { params: Promise<{ docId: string }> }) {
  const { docId } = use(params);
  const router = useRouter();
  const { user } = useSession();
  const { data: doc, error, isPending } = useDocument(docId);
  const [conn, setConn] = useState<ConnectionStatus>('connecting');
  const [peers, setPeers] = useState<Peer[]>([]);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [sheet, setSheet] = useState<'share' | 'details' | null>(null);
  const onStatus = useCallback((s: ConnectionStatus) => setConn(s), []);

  if (error) return <p className="p-10 text-center text-ink-2">{error.message}</p>;
  if (isPending || !doc || !user) return <div className="mx-auto mt-24 h-8 w-2/3 max-w-xl animate-pulse rounded-lg bg-surface-2" />;

  const canEdit = doc.myPermission === 'edit' || doc.myPermission === 'manage';
  const contentUrl = `/files/${doc.id}/content`;
  const sheets = (
    <>
      {sheet === 'share' && <ShareSheet open onOpenChange={(v) => !v && setSheet(null)} type="document" id={doc.id} name={doc.title} />}
      <BottomSheet open={sheet === 'details'} onOpenChange={(v) => !v && setSheet(null)} title="Details">
        <DocDetails doc={doc} />
      </BottomSheet>
    </>
  );
  const toolbar = (
    <div className="flex items-center gap-1.5">
      <VerifyButton doc={doc} compact />
      <button onClick={() => setSheet('share')} className="press inline-flex items-center gap-1.5 rounded-pill border border-line bg-surface px-3.5 py-2 text-sm font-semibold">
        <Share2 className="size-4" /> <span className="hidden sm:inline">Share</span>
      </button>
      <button onClick={() => setSheet('details')} className="press grid size-9 place-items-center rounded-full border border-line bg-surface xl:hidden" aria-label="Details">
        <Info className="size-4" />
      </button>
    </div>
  );

  if (doc.kind === 'file') {
    const flavor = fileFlavor(doc.mimeType, doc.title);
    return (
      <div className="flex h-[calc(100dvh-4.25rem-env(safe-area-inset-bottom))] flex-col md:h-dvh">
        <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-line bg-surface px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
          <button onClick={() => router.back()} className="press grid size-9 shrink-0 place-items-center rounded-full hover:bg-surface-2" aria-label="Back">
            <ArrowLeft className="size-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-semibold">{doc.title}</h1>
            <p className="truncate text-meta text-ink-3">
              {doc.updatedByName ? `${doc.updatedByName} · ` : ''}
              {relativeTime(doc.updatedAt)}
            </p>
          </div>
          <button onClick={() => setSheet('share')} className="press grid size-9 place-items-center rounded-full hover:bg-surface-2" aria-label="Share">
            <Share2 className="size-5" />
          </button>
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
        {sheets}
      </div>
    );
  }

  if (doc.kind === 'folder') {
    return <p className="p-10 text-center text-ink-2">This is a folder — open it from its space.</p>;
  }

  const typeLabel = doc.pageType === 'runbook' ? 'Runbook' : doc.pageType === 'kb' ? 'KB article' : null;

  return (
    <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_17rem]">
      <article className="min-h-dvh bg-surface xl:border-r xl:border-line">
        {/* Top bar */}
        <div className="sticky top-0 z-20 flex items-center gap-2 bg-surface/90 px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur md:px-6">
          <button onClick={() => router.back()} className="press grid size-9 shrink-0 place-items-center rounded-full hover:bg-surface-2 md:hidden" aria-label="Back">
            <ArrowLeft className="size-5" />
          </button>
          <div className="min-w-0 flex-1">
            <Breadcrumb doc={doc} />
          </div>
          {toolbar}
        </div>

        <div className="mx-auto max-w-3xl px-5 pb-32 pt-4 md:px-10">
          <PageIcon id={doc.id} icon={doc.icon} editable={canEdit} />
          <TitleInput id={doc.id} title={doc.title} editable={canEdit} />
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <StatusBadge status={doc.status} since={doc.verifiedAt} />
            {typeLabel && <span className="inline-flex items-center rounded-pill bg-accent-soft px-2 py-0.5 text-[0.6875rem] font-semibold text-accent">{typeLabel}</span>}
            {doc.tags.map((t) => (
              <TagChip key={t}>{t}</TagChip>
            ))}
            <span className="text-meta text-ink-3">
              {doc.updatedByName ? `Edited by ${doc.updatedByName} · ` : 'Edited '}
              {relativeTime(doc.updatedAt)}
              {!canEdit && ' · View only'}
            </span>
          </div>
          <div className="mt-5">
            <CollaborativeEditor
              documentId={doc.id}
              user={{ id: user.id, displayName: user.displayName }}
              editable={canEdit}
              initialHtml={doc.importHtml}
              onStatusChange={onStatus}
              onPeers={setPeers}
              onOutline={setOutline}
            />
          </div>
        </div>
      </article>

      {/* Right rail (wide screens) */}
      <aside className="hidden xl:block">
        <div className="sticky top-0 max-h-dvh space-y-6 overflow-y-auto p-5">
          <Presence status={conn} peers={peers} />
          <Outline items={outline} />
          <section>
            <h3 className="mb-1 text-meta font-semibold uppercase tracking-wider text-ink-3">Details</h3>
            <DocDetails doc={doc} />
          </section>
        </div>
      </aside>
      {sheets}
    </div>
  );
}
