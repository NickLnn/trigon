'use client';

import { Extension, type Editor, type Range } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import Suggestion, { type SuggestionProps } from '@tiptap/suggestion';
import {
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  Table as TableIcon,
  Clapperboard,
  type LucideIcon,
} from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

export interface SlashItem {
  title: string;
  description: string;
  keywords: string;
  icon: LucideIcon;
  /** Runs the command. Returning 'embed' switches the menu into URL-input mode. */
  run: (editor: Editor, range: Range) => void | 'embed';
}

export interface SlashOptions {
  uploadImage: (file: File) => Promise<string>;
}

function pickImage(editor: Editor, upload: SlashOptions['uploadImage']) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    const src = await upload(file);
    editor.chain().focus().setImage({ src, alt: file.name }).run();
  };
  input.click();
}

export function slashItems(upload: SlashOptions['uploadImage']): SlashItem[] {
  return [
    { title: 'Text', description: 'Plain paragraph', keywords: 'paragraph p', icon: Pilcrow, run: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run() },
    { title: 'Heading 1', description: 'Large section heading', keywords: 'h1 title', icon: Heading1, run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 1 }).run() },
    { title: 'Heading 2', description: 'Medium section heading', keywords: 'h2 subtitle', icon: Heading2, run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 2 }).run() },
    { title: 'Heading 3', description: 'Small section heading', keywords: 'h3', icon: Heading3, run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 3 }).run() },
    { title: 'Bullet list', description: 'Simple bulleted list', keywords: 'ul unordered', icon: List, run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
    { title: 'Numbered list', description: 'List with numbering', keywords: 'ol ordered 1.', icon: ListOrdered, run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
    { title: 'To-do list', description: 'Track tasks with checkboxes', keywords: 'task todo checkbox check', icon: ListChecks, run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run() },
    { title: 'Quote', description: 'Capture a quotation', keywords: 'blockquote citation', icon: Quote, run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
    {
      title: 'Code block',
      description: 'Paste code — language is detected automatically',
      keywords: 'code snippet script yaml json powershell bash',
      icon: Code2,
      run: (e, r) => e.chain().focus().deleteRange(r).setCodeBlock().run(),
    },
    {
      title: 'Table',
      description: '3 × 3 table with header row',
      keywords: 'grid rows columns',
      icon: TableIcon,
      run: (e, r) => e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    },
    { title: 'Divider', description: 'Horizontal line', keywords: 'hr separator line rule', icon: Minus, run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
    {
      title: 'Image',
      description: 'Upload an image',
      keywords: 'picture photo screenshot upload',
      icon: ImageIcon,
      run: (e, r) => {
        e.chain().focus().deleteRange(r).run();
        pickImage(e, upload);
      },
    },
    {
      title: 'Embed',
      description: 'YouTube, Vimeo, Loom or any link',
      keywords: 'video youtube vimeo loom link url bookmark',
      icon: Clapperboard,
      run: () => 'embed',
    },
  ];
}

interface MenuProps extends SuggestionProps<SlashItem> {
  items: SlashItem[];
}

export interface MenuHandle {
  onKeyDown: (e: KeyboardEvent) => boolean;
}

const SlashMenu = forwardRef<MenuHandle, MenuProps>(function SlashMenu({ items, editor, range }, ref) {
  const [index, setIndex] = useState(0);
  const [embedMode, setEmbedMode] = useState(false);
  const [url, setUrl] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => setIndex(0), [items]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const select = (i: number) => {
    const item = items[i];
    if (!item) return;
    if (item.run(editor, range) === 'embed') setEmbedMode(true);
  };

  const insertEmbed = () => {
    const value = url.trim();
    if (!/^https?:\/\//.test(value)) return;
    editor.chain().focus().deleteRange(range).setEmbed(value).run();
  };

  useImperativeHandle(ref, () => ({
    onKeyDown: (e) => {
      if (embedMode) return false;
      if (e.key === 'ArrowUp') {
        setIndex((i) => (i + items.length - 1) % items.length);
        return true;
      }
      if (e.key === 'ArrowDown') {
        setIndex((i) => (i + 1) % items.length);
        return true;
      }
      if (e.key === 'Enter') {
        select(index);
        return true;
      }
      return false;
    },
  }));

  if (embedMode) {
    return (
      <form
        className="w-80 rounded-2xl bg-surface p-3 shadow-float ring-1 ring-line"
        onSubmit={(e) => {
          e.preventDefault();
          insertEmbed();
        }}
      >
        <p className="mb-2 text-meta font-semibold text-ink-2">Paste a link</p>
        <input
          autoFocus
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && editor.chain().focus().deleteRange(range).run()}
          placeholder="https://youtube.com/watch?v=…"
          className="w-full rounded-xl bg-surface-2 px-3 py-2 text-sm outline-none ring-accent focus:ring-2"
        />
        <button className="mt-2 w-full rounded-pill bg-accent py-2 text-sm font-semibold text-accent-ink">Embed</button>
      </form>
    );
  }

  if (!items.length) return <div className="rounded-xl bg-surface px-3 py-2 text-sm text-ink-3 shadow-float ring-1 ring-line">No matching blocks</div>;

  return (
    <div ref={listRef} className="no-scrollbar max-h-80 w-72 overflow-y-auto rounded-2xl bg-surface p-1.5 shadow-float ring-1 ring-line">
      {items.map((item, i) => (
        <button
          key={item.title}
          data-index={i}
          onMouseEnter={() => setIndex(i)}
          onMouseDown={(e) => {
            e.preventDefault();
            select(i);
          }}
          className={`flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left ${i === index ? 'bg-surface-2' : ''}`}
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-line bg-surface text-ink-2">
            <item.icon className="size-4.5" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold">{item.title}</span>
            <span className="block truncate text-meta text-ink-3">{item.description}</span>
          </span>
        </button>
      ))}
    </div>
  );
});

/** Position the floating menu under the caret, flipping above when there's no room. */
function place(el: HTMLElement, rect: DOMRect | null | undefined) {
  if (!rect) return;
  const { innerHeight, innerWidth } = window;
  const h = el.offsetHeight || 320;
  const w = el.offsetWidth || 288;
  const top = rect.bottom + h + 12 > innerHeight ? rect.top - h - 6 : rect.bottom + 6;
  el.style.top = `${Math.max(8, top + window.scrollY)}px`;
  el.style.left = `${Math.min(Math.max(8, rect.left), innerWidth - w - 8) + window.scrollX}px`;
}

/**
 * Notion/Docmost-style "/" command menu: type "/" (optionally followed by a filter like "/code")
 * to insert headings, lists, to-dos, quotes, code blocks, tables, dividers, images and embeds.
 */
export const SlashCommand = Extension.create<SlashOptions>({
  name: 'slashCommand',

  addOptions() {
    return { uploadImage: async () => '' };
  },

  addProseMirrorPlugins() {
    const all = slashItems(this.options.uploadImage);
    return [
      Suggestion<SlashItem>({
        editor: this.editor,
        char: '/',
        pluginKey: new PluginKey('slashCommand'),
        allowSpaces: false,
        startOfLine: false,
        // Not inside code blocks (paths like /etc/hosts must stay typeable).
        allow: ({ state, range }) => !state.doc.resolve(range.from).parent.type.spec.code,
        items: ({ query }) => {
          const q = query.toLowerCase();
          return all.filter((i) => !q || i.title.toLowerCase().includes(q) || i.keywords.includes(q));
        },
        command: ({ editor, range, props }) => props.run(editor, range),
        render: () => {
          let renderer: ReactRenderer<MenuHandle, MenuProps> | null = null;
          let el: HTMLDivElement | null = null;
          return {
            onStart: (props) => {
              renderer = new ReactRenderer(SlashMenu, { props, editor: props.editor });
              el = document.createElement('div');
              el.style.position = 'absolute';
              el.style.zIndex = '60';
              el.appendChild(renderer.element);
              document.body.appendChild(el);
              requestAnimationFrame(() => el && place(el, props.clientRect?.()));
            },
            onUpdate: (props) => {
              renderer?.updateProps(props);
              if (el) place(el, props.clientRect?.());
            },
            onKeyDown: ({ event }) => {
              if (event.key === 'Escape') {
                el?.remove();
                return true;
              }
              return renderer?.ref?.onKeyDown(event) ?? false;
            },
            onExit: () => {
              renderer?.destroy();
              el?.remove();
              renderer = null;
              el = null;
            },
          };
        },
      }),
    ];
  },
});
