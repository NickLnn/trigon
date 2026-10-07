import { mergeAttributes, Node } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { matchEmbedProvider } from '@trigon/shared';
import { EmbedView } from './embed-view';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    embed: {
      setEmbed: (url: string) => ReturnType;
    };
  }
}

export function embedAttrsFor(url: string) {
  const match = matchEmbedProvider(url);
  return match
    ? { url, kind: 'video', provider: match.provider, embedUrl: match.embedUrl }
    : { url, kind: 'link', provider: null, embedUrl: null };
}

/**
 * Media embeds. Pasting a bare YouTube / Vimeo / Loom URL inserts a responsive player; any other
 * URL pasted on an empty line becomes a link card that unfurls via the API's oEmbed/Open Graph
 * endpoint. Attributes are stored in the document so collaborators see the same card.
 */
export const Embed = Node.create({
  name: 'embed',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      url: { default: null },
      kind: { default: 'link' },
      provider: { default: null },
      embedUrl: { default: null },
      title: { default: null },
      description: { default: null },
      thumbnailUrl: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-embed]',
        getAttrs: (el) => {
          const e = el as HTMLElement;
          return { ...embedAttrsFor(e.getAttribute('data-url') ?? ''), title: e.getAttribute('data-title') };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-embed': node.attrs.kind,
        'data-url': node.attrs.url,
        'data-title': node.attrs.title,
      }),
      ['a', { href: node.attrs.url, rel: 'noopener noreferrer', target: '_blank' }, node.attrs.title ?? node.attrs.url],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(EmbedView);
  },

  addCommands() {
    return {
      setEmbed:
        (url) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: embedAttrsFor(url) }),
    };
  },

  addProseMirrorPlugins() {
    const type = this.type;
    return [
      new Plugin({
        key: new PluginKey('embedPaste'),
        props: {
          handlePaste(view, event) {
            const text = event.clipboardData?.getData('text/plain')?.trim() ?? '';
            if (!/^https?:\/\/\S+$/.test(text)) return false;
            const { $from, empty } = view.state.selection;
            const isVideo = !!matchEmbedProvider(text);
            const onEmptyLine = empty && $from.parent.type.name === 'paragraph' && $from.parent.content.size === 0;
            // Videos embed anywhere; other links only become cards on an empty line (else: normal link).
            if (!isVideo && !onEmptyLine) return false;
            const node = type.create(embedAttrsFor(text));
            const tr = onEmptyLine
              ? view.state.tr.replaceRangeWith($from.before(), $from.after(), node)
              : view.state.tr.replaceSelectionWith(node);
            view.dispatch(tr.scrollIntoView());
            return true;
          },
        },
      }),
    ];
  },
});
