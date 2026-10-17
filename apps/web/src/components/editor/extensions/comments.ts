import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { absolutePositionToRelativePosition, relativePositionToAbsolutePosition, ySyncPluginKey } from '@tiptap/y-tiptap';
import type { CommentThread } from '@trigon/shared';
import * as Y from 'yjs';

/**
 * Comment highlights. Threads are anchored with Yjs relative positions (stored by the API, not in the
 * page), so they follow the text as people edit and work for read-only viewers too. This plugin turns
 * them into inline decorations, and clicking one selects its thread.
 */

export interface CommentAnchor {
  anchorFrom: string;
  anchorTo: string;
  quote: string;
}

export interface CommentsStorage {
  threads: CommentThread[];
  activeId: string | null;
  /** A passage someone is about to comment on (highlighted until the comment is posted or cancelled). */
  draft: CommentAnchor | null;
  onSelect: (threadId: string) => void;
}

export const commentsKey = new PluginKey<DecorationSet>('trigonComments');

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

interface YSync {
  doc: Y.Doc;
  binding: { type: Y.XmlFragment; mapping: Map<unknown, unknown> } | null;
}

function ySync(state: EditorState): YSync | null {
  const s = ySyncPluginKey.getState(state) as YSync | undefined;
  return s?.doc && s.binding && s.binding.mapping.size > 0 ? s : null;
}

/** Where an anchor is in the current document, or null if its text was deleted. */
function resolve(state: EditorState, y: YSync, from: string, to: string): { from: number; to: number } | null {
  try {
    const a = relativePositionToAbsolutePosition(y.doc, y.binding!.type, Y.decodeRelativePosition(fromBase64(from)), y.binding!.mapping as never);
    const b = relativePositionToAbsolutePosition(y.doc, y.binding!.type, Y.decodeRelativePosition(fromBase64(to)), y.binding!.mapping as never);
    if (a == null || b == null) return null;
    const lo = Math.max(0, Math.min(a, b));
    const hi = Math.min(state.doc.content.size, Math.max(a, b));
    return hi > lo ? { from: lo, to: hi } : null;
  } catch {
    return null;
  }
}

function build(state: EditorState, store: CommentsStorage): DecorationSet {
  const y = ySync(state);
  if (!y) return DecorationSet.empty;
  const decos: Decoration[] = [];
  for (const t of store.threads) {
    if (t.resolvedAt || !t.anchorFrom || !t.anchorTo) continue;
    const r = resolve(state, y, t.anchorFrom, t.anchorTo);
    if (r) decos.push(Decoration.inline(r.from, r.to, { class: `trigon-comment${t.id === store.activeId ? ' is-active' : ''}`, 'data-thread': t.id }));
  }
  if (store.draft) {
    const r = resolve(state, y, store.draft.anchorFrom, store.draft.anchorTo);
    if (r) decos.push(Decoration.inline(r.from, r.to, { class: 'trigon-comment is-draft' }));
  }
  return DecorationSet.create(state.doc, decos);
}

export const Comments = Extension.create<object, CommentsStorage>({
  name: 'trigonComments',

  addStorage() {
    return { threads: [], activeId: null, draft: null, onSelect: () => undefined };
  },

  addProseMirrorPlugins() {
    const store = this.storage;
    return [
      new Plugin<DecorationSet>({
        key: commentsKey,
        state: {
          init: (_, state) => build(state, store),
          apply: (tr, old, _prev, state) => {
            // Re-resolve the anchors from Yjs when the threads change, or when a change comes *from* Yjs
            // (someone else's edit, the first sync): then the Yjs document is already up to date.
            const fromYjs = (tr.getMeta(ySyncPluginKey) as { isChangeOrigin?: boolean } | undefined)?.isChangeOrigin;
            if (tr.getMeta(commentsKey) || fromYjs) return build(state, store);
            // A local edit reaches Yjs only after this transaction, so its positions would be stale:
            // shift the highlights along with the edit instead.
            return tr.docChanged ? old.map(tr.mapping, tr.doc) : old;
          },
        },
        props: {
          decorations: (state) => commentsKey.getState(state),
          handleClick: (_view, _pos, event) => {
            const el = (event.target as HTMLElement | null)?.closest?.('[data-thread]');
            const id = el?.getAttribute('data-thread');
            if (id) store.onSelect(id);
            return false;
          },
        },
      }),
    ];
  },
});

/** Push new threads / active thread / draft into the editor and redraw. */
export function updateComments(editor: Editor, patch: Partial<CommentsStorage>) {
  const store = (editor.storage as unknown as { trigonComments: CommentsStorage }).trigonComments;
  Object.assign(store, patch);
  if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(commentsKey, true));
}

/**
 * The passage the person has selected in the page, as a comment anchor. Read from the DOM selection,
 * because a read-only editor (comment access) doesn't track its selection in ProseMirror state.
 */
export function selectionAnchor(view: EditorView): CommentAnchor | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.anchorNode || !sel.focusNode) return null;
  if (!view.dom.contains(sel.anchorNode) || !view.dom.contains(sel.focusNode)) return null;
  const y = ySync(view.state);
  if (!y) return null;
  let from: number;
  let to: number;
  try {
    const a = view.posAtDOM(sel.anchorNode, sel.anchorOffset);
    const b = view.posAtDOM(sel.focusNode, sel.focusOffset);
    from = Math.min(a, b);
    to = Math.max(a, b);
  } catch {
    return null;
  }
  const quote = view.state.doc.textBetween(from, to, ' ').replace(/\s+/g, ' ').trim();
  if (!quote) return null;
  const enc = (pos: number) => toBase64(Y.encodeRelativePosition(absolutePositionToRelativePosition(pos, y.binding!.type, y.binding!.mapping as never)));
  return { anchorFrom: enc(from), anchorTo: enc(to), quote: quote.slice(0, 500) };
}

/** Document position of a thread's passage (to scroll to it), or null. */
export function threadRange(editor: Editor, thread: Pick<CommentThread, 'anchorFrom' | 'anchorTo'>) {
  if (!thread.anchorFrom || !thread.anchorTo) return null;
  const y = ySync(editor.state);
  return y ? resolve(editor.state, y, thread.anchorFrom, thread.anchorTo) : null;
}
