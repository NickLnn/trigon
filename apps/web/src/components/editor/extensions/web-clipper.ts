import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { cleanPastedHtml, sourceUrlFromClipboard } from '@/lib/html-clean';

export interface WebClipperOptions {
  /** Copy a remote image into Trigon storage; resolves to the local URL. */
  importImage: (url: string) => Promise<string>;
  /** Upload a pasted/dropped image file; resolves to the local URL. */
  uploadImage: (file: File) => Promise<string>;
}

const key = new PluginKey('webClipper');
const isLocal = (src: string) => src.startsWith('/api/files/') || src.startsWith(location.origin + '/api/files/');

function replaceImageSrc(view: EditorView, from: string, to: string | null) {
  const { tr, doc } = view.state;
  doc.descendants((node: PMNode, pos: number) => {
    if (node.type.name === 'image' && node.attrs.src === from) {
      if (to) tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: to });
      else tr.delete(pos, pos + node.nodeSize);
    }
  });
  if (tr.docChanged) view.dispatch(tr.setMeta('addToHistory', false));
}

/**
 * Rich web importer: cleans HTML pasted from other sites (see cleanPastedHtml), then re-hosts every
 * external image locally so clipped content survives the source page changing or disappearing.
 * Also handles pasting/dropping image files.
 */
export interface WebClipperStorage {
  /** Set before programmatic inserts (imports) so their external images get re-hosted too. */
  scanNext: boolean;
}

export const WebClipper = Extension.create<WebClipperOptions, WebClipperStorage>({
  name: 'webClipper',

  addStorage() {
    return { scanNext: false };
  },

  addOptions() {
    return {
      importImage: async (url) => url,
      uploadImage: async () => {
        throw new Error('uploadImage not configured');
      },
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    const storage = this.storage;
    let lastSourceUrl: string | null = null;
    let scanAfterPaste = false;
    const inFlight = new Set<string>();

    const insertUploaded = (view: EditorView, files: File[], pos?: number) => {
      const images = files.filter((f) => f.type.startsWith('image/'));
      if (!images.length) return false;
      for (const file of images) {
        options
          .uploadImage(file)
          .then((src) => {
            const node = view.state.schema.nodes.image?.create({ src, alt: file.name });
            if (!node) return;
            const tr = pos !== undefined ? view.state.tr.insert(pos, node) : view.state.tr.replaceSelectionWith(node);
            view.dispatch(tr.scrollIntoView());
          })
          .catch((err) => console.error('Image upload failed', err));
      }
      return true;
    };

    return [
      new Plugin({
        key,
        props: {
          handlePaste(view, event) {
            const data = event.clipboardData;
            lastSourceUrl = sourceUrlFromClipboard(data);
            const files = Array.from(data?.files ?? []);
            // Image-only clipboard (screenshot): upload it.
            if (files.length && !data?.getData('text/html')) return insertUploaded(view, files);
            scanAfterPaste = true;
            return false;
          },
          handleDrop(view, event) {
            const files = Array.from(event.dataTransfer?.files ?? []);
            if (!files.length) return false;
            const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
            event.preventDefault();
            return insertUploaded(view, files, pos);
          },
          transformPastedHTML(html) {
            return cleanPastedHtml(html, lastSourceUrl);
          },
        },
        view: () => ({
          update(view) {
            if (!scanAfterPaste && !storage.scanNext) return;
            scanAfterPaste = false;
            storage.scanNext = false;
            view.state.doc.descendants((node) => {
              if (node.type.name !== 'image') return;
              const src: string = node.attrs.src ?? '';
              if (!/^https?:\/\//.test(src) || isLocal(src) || inFlight.has(src)) return;
              inFlight.add(src);
              options
                .importImage(src)
                .then((local) => replaceImageSrc(view, src, local))
                .catch(() => {
                  /* keep the remote URL if the import is refused (too large, not an image, …) */
                })
                .finally(() => inFlight.delete(src));
            });
          },
        }),
      }),
    ];
  },
});
