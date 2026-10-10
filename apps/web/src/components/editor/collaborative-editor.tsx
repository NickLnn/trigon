'use client';

import { HocuspocusProvider } from '@hocuspocus/provider';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import Image from '@tiptap/extension-image';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import { Placeholder } from '@tiptap/extensions';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { api, collabUrl } from '@/lib/api';
import { AutoCodeDetect } from './extensions/auto-code';
import { Callout } from './extensions/callout';
import { CodeBlock } from './extensions/code-block';
import { Embed } from './extensions/embed';
import { SlashCommand } from './extensions/slash-command';
import { WebClipper, type WebClipperStorage } from './extensions/web-clipper';

const CARET_COLORS = ['#0666EB', '#E5383B', '#00A86B', '#F5A623', '#8E44EC', '#FF6B9A', '#00B5D8'];

function colorFor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return CARET_COLORS[Math.abs(h) % CARET_COLORS.length];
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';
export interface Peer {
  name: string;
  color: string;
}
/** saved: server has every edit · saving: edits in flight · offline: edits only in this tab */
export type SaveState = 'saved' | 'saving' | 'offline';
export interface OutlineItem {
  level: number;
  text: string;
}

interface Props {
  documentId: string;
  user: { id: string; displayName: string };
  editable: boolean;
  /** Imported HTML to load into the page the first time it is opened (while the doc is still empty). */
  initialHtml?: string | null;
  onStatusChange?: (status: ConnectionStatus, peers: number) => void;
  /** Everyone currently in the document (from Yjs awareness). */
  onPeers?: (peers: Peer[]) => void;
  /** Headings, in order — for the "On this page" outline. */
  onOutline?: (items: OutlineItem[]) => void;
  onSaveState?: (state: SaveState) => void;
}

async function uploadAttachment(documentId: string, file: File) {
  const form = new FormData();
  form.append('documentId', documentId);
  form.append('file', file);
  const res = await api<{ url: string }>('/files/attachments', { method: 'POST', body: form });
  return res.url;
}

/**
 * Block editor bound to a Yjs document synced through Hocuspocus. Every keystroke is a CRDT
 * update, so concurrent edits merge without conflicts; the server persists the doc state.
 */
export function CollaborativeEditor({ documentId, user, editable, initialHtml, onStatusChange, onPeers, onOutline, onSaveState }: Props) {
  const ydoc = useMemo(() => new Y.Doc(), [documentId]);
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null);
  const [synced, setSynced] = useState(false);
  const seeded = useRef(false);

  useEffect(() => {
    let connected = false;
    let unsynced = 0;
    const report = () => onSaveState?.(!connected ? (unsynced > 0 ? 'offline' : 'saving') : unsynced > 0 ? 'saving' : 'saved');
    const p = new HocuspocusProvider({
      url: collabUrl(),
      name: documentId,
      document: ydoc,
      // Fetched fresh on every (re)connect, so expired tokens never strand a session.
      token: async () => (await api<{ token: string }>('/auth/collab-token')).token,
      onStatus: ({ status }) => {
        connected = status === 'connected';
        report();
        onStatusChange?.(status as ConnectionStatus, p.awareness?.getStates().size ?? 1);
      },
      onUnsyncedChanges: ({ number }) => {
        unsynced = number;
        report();
      },
      onAwarenessChange: ({ states }) => {
        onStatusChange?.('connected', states.length);
        onPeers?.(
          states
            .map((s) => (s as { user?: Peer }).user)
            .filter((u): u is Peer => !!u?.name),
        );
      },
      onSynced: () => {
        setSynced(true);
        report();
      },
    });
    setProvider(p);

    // Closing/reloading the tab with edits the server hasn't confirmed would lose them — ask first.
    const beforeUnload = (e: BeforeUnloadEvent) => {
      p.flushPendingUpdates();
      if (p.hasUnsyncedChanges) e.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);

    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      // Send any batched edits before the socket closes (in-app navigation).
      p.flushPendingUpdates();
      p.destroy();
      setProvider(null);
      setSynced(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, ydoc]);

  useEffect(() => () => ydoc.destroy(), [ydoc]);

  const editor = useEditor(
    {
      immediatelyRender: false,
      editable,
      editorProps: {
        attributes: { class: 'trigon-prose', spellcheck: 'true' },
      },
      extensions: [
        StarterKit.configure({
          undoRedo: false, // Yjs owns history so undo is per-user, not global
          codeBlock: false,
          link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
        }),
        CodeBlock,
        Callout,
        Image.configure({ inline: false, allowBase64: false }),
        // variant="steps" renders a numbered procedure (runbooks) instead of a plain checklist.
        TaskList.extend({
          addAttributes() {
            return {
              variant: {
                default: null,
                parseHTML: (el) => el.getAttribute('data-variant'),
                renderHTML: (attrs) => (attrs.variant ? { 'data-variant': attrs.variant } : {}),
              },
            };
          },
        }),
        TaskItem.configure({ nested: true }),
        TableKit.configure({ table: { resizable: true } }),
        SlashCommand.configure({ uploadImage: (file) => uploadAttachment(documentId, file) }),
        Placeholder.configure({
          placeholder: ({ node }) => (node.type.name === 'heading' ? 'Heading' : "Type '/' for commands, or paste code, a link or a web page…"),
        }),
        Embed,
        // Order matters: embeds claim bare URLs, then code detection, then the HTML clipper.
        AutoCodeDetect,
        WebClipper.configure({
          uploadImage: (file) => uploadAttachment(documentId, file),
          importImage: async (url) =>
            (await api<{ url: string }>('/files/attachments/import', { method: 'POST', json: { documentId, url } })).url,
        }),
        Collaboration.configure({ document: ydoc }),
        ...(provider
          ? [CollaborationCaret.configure({ provider, user: { name: user.displayName, color: colorFor(user.id) } })]
          : []),
      ],
    },
    [provider, documentId],
  );

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  useEffect(() => {
    if (!editor || !onOutline) return;
    const emit = () => {
      const items: OutlineItem[] = [];
      editor.state.doc.forEach((node) => {
        if (node.type.name === 'heading' && node.textContent.trim()) items.push({ level: node.attrs.level, text: node.textContent.trim() });
      });
      onOutline(items);
    };
    emit();
    editor.on('update', emit);
    return () => {
      editor.off('update', emit);
    };
  }, [editor, onOutline]);

  // Materialise an import once the server state has arrived and turned out to be empty.
  useEffect(() => {
    if (!editor || !synced || !initialHtml || !editable || seeded.current) return;
    seeded.current = true;
    if (ydoc.getXmlFragment('default').length > 0) return;
    (editor.storage as unknown as { webClipper: WebClipperStorage }).webClipper.scanNext = true;
    editor.commands.setContent(initialHtml);
  }, [editor, synced, initialHtml, editable, ydoc]);

  return <EditorContent editor={editor} />;
}
