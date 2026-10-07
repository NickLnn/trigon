import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { detectLanguage, fromVsCodeMode, scoreCode } from '@/lib/code-detect';

const key = new PluginKey('autoCodeDetect');

function insertCodeBlock(view: EditorView, text: string, language: string | null) {
  const { schema, tr } = view.state;
  const codeBlock = schema.nodes.codeBlock;
  if (!codeBlock) return false;
  const node = codeBlock.create({ language }, text ? schema.text(text.replace(/\r\n?/g, '\n')) : null);
  view.dispatch(tr.replaceSelectionWith(node).scrollIntoView());
  return true;
}

/**
 * Auto code detection.
 *
 * On paste: plain text that the classifier scores as source code becomes a syntax-highlighted
 * code block with the detected language. VS Code pastes carry their language id and are honoured
 * directly. HTML pastes are left to the web clipper (which preserves <pre> blocks itself).
 *
 * On input: code blocks typed or created without a language get one detected after a short pause.
 */
export const AutoCodeDetect = Extension.create({
  name: 'autoCodeDetect',

  addProseMirrorPlugins() {
    let timer: ReturnType<typeof setTimeout> | undefined;

    return [
      new Plugin({
        key,
        props: {
          handlePaste(view, event) {
            const data = event.clipboardData;
            if (!data) return false;
            const { $from } = view.state.selection;
            if ($from.parent.type.spec.code) return false; // already inside a code block: plain paste

            const text = data.getData('text/plain');
            if (!text.trim()) return false;

            const vscode = data.getData('vscode-editor-data');
            if (vscode) {
              let mode: string | undefined;
              try {
                mode = JSON.parse(vscode).mode;
              } catch {
                /* ignore */
              }
              const language = fromVsCodeMode(mode);
              if (text.includes('\n') || language) {
                return insertCodeBlock(view, text, language ?? detectLanguage(text));
              }
              return false;
            }

            if (data.getData('text/html')) return false;
            if (/^\s*https?:\/\/\S+\s*$/.test(text)) return false; // bare URL → embeds/links

            if (!scoreCode(text).isCode) return false;
            return insertCodeBlock(view, text, detectLanguage(text));
          },
        },
        view: () => ({
          update(view, prev) {
            if (prev.doc.eq(view.state.doc)) return;
            clearTimeout(timer);
            timer = setTimeout(() => {
              if (view.isDestroyed) return;
              const { tr, doc } = view.state;
              let changed = false;
              doc.descendants((node, pos) => {
                if (node.type.name !== 'codeBlock' || node.attrs.language) return node.type.name !== 'codeBlock';
                if (node.textContent.trim().length < 24) return false;
                const language = detectLanguage(node.textContent);
                if (language) {
                  tr.setNodeMarkup(pos, undefined, { ...node.attrs, language });
                  changed = true;
                }
                return false;
              });
              if (changed) view.dispatch(tr.setMeta('addToHistory', false));
            }, 800);
          },
          destroy() {
            clearTimeout(timer);
          },
        }),
      }),
    ];
  },
});
