'use client';

import { HocuspocusProvider } from '@hocuspocus/provider';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Image from '@tiptap/extension-image';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Placeholder } from '@tiptap/extensions';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { api, collabUrl } from '@/lib/api';
import { lowlight } from '@/lib/code-detect';
import { AutoCodeDetect } from './extensions/auto-code';
import { Embed } from './extensions/embed';
import { WebClipper, type WebClipperStorage } from './extensions/web-clipper';

const CARET_COLORS = ['#0666EB', '#E5383B', '#00A86B', '#F5A623', '#8E44EC', '#FF6B9A', '#00B5D8'];

function colorFor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return CARET_COLORS[Math.abs(h) % CARET_COLORS.length];
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

interface Props {
  documentId: string;
  user: { id: string; displayName: string };
  editable: boolean;
  /** Imported HTML to load into the page the first time it is opened (while the doc is still empty). */
  initialHtml?: string | null;
  onStatusChange?: (status: ConnectionStatus, peers: number) => void;
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
export function CollaborativeEditor({ documentId, user, editable, initialHtml, onStatusChange }: Props) {
  const ydoc = useMemo(() => new Y.Doc(), [documentId]);
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null);
  const [synced, setSynced] = useState(false);
  const seeded = useRef(false);

  useEffect(() => {
    const p = new HocuspocusProvider({
      url: collabUrl(),
      name: documentId,
      document: ydoc,
      // Fetched fresh on every (re)connect, so expired tokens never strand a session.
      token: async () => (await api<{ token: string }>('/auth/collab-token')).token,
      onStatus: ({ status }) => onStatusChange?.(status as ConnectionStatus, p.awareness?.getStates().size ?? 1),
      onAwarenessChange: ({ states }) => onStatusChange?.('connected', states.length),
      onSynced: () => setSynced(true),
    });
    setProvider(p);
    return () => {
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
        CodeBlockLowlight.configure({ lowlight, defaultLanguage: null }),
        Image.configure({ inline: false, allowBase64: false }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Placeholder.configure({
          placeholder: ({ node }) => (node.type.name === 'heading' ? 'Heading' : 'Write something, or paste code, a link or a web page…'),
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
