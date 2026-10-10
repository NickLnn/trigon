import Image from '@tiptap/extension-image';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import StarterKit from '@tiptap/starter-kit';
import { Callout } from './callout';
import { CodeBlock } from './code-block';
import { Embed } from './embed';

/** Task list with variant="steps" → numbered procedure (runbooks). */
export const StepsTaskList = TaskList.extend({
  addAttributes() {
    return {
      variant: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-variant'),
        renderHTML: (attrs) => (attrs.variant ? { 'data-variant': attrs.variant } : {}),
      },
    };
  },
});

/**
 * Everything a page can contain — the document schema. Shared by the live editor and by export
 * (generateHTML), so both always agree on what a page is.
 */
export const contentExtensions = [
  StarterKit.configure({
    undoRedo: false, // Yjs owns history so undo is per-user, not global
    codeBlock: false,
    link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
  }),
  CodeBlock,
  Callout,
  Image.configure({ inline: false, allowBase64: false }),
  StepsTaskList,
  TaskItem.configure({ nested: true }),
  TableKit.configure({ table: { resizable: true } }),
  Embed,
];
