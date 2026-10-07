import { marked } from 'marked';
import { api } from './api';
import { cleanPastedHtml } from './html-clean';

export const IMPORT_ACCEPT = '.md,.markdown,.mdx,.txt,.html,.htm,text/markdown,text/html';

/** Turn GitHub-style `- [ ] item` lists (rendered by marked as checkboxes) into Tiptap task lists. */
function toTaskLists(doc: Document) {
  doc.querySelectorAll('ul').forEach((ul) => {
    const items = Array.from(ul.children).filter((c) => c.tagName === 'LI');
    if (!items.length || !items.every((li) => li.querySelector(':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]'))) return;
    ul.setAttribute('data-type', 'taskList');
    items.forEach((li) => {
      const box = li.querySelector('input[type="checkbox"]') as HTMLInputElement;
      li.setAttribute('data-type', 'taskItem');
      li.setAttribute('data-checked', box.hasAttribute('checked') ? 'true' : 'false');
      box.remove();
    });
  });
}

export interface ParsedImport {
  title: string;
  html: string;
}

/** Read a .md/.html file into a title + clean HTML ready for the editor. */
export async function parseImportFile(file: File): Promise<ParsedImport> {
  const raw = await file.text();
  const isHtml = /\.html?$/i.test(file.name) || file.type === 'text/html' || /^\s*<(!doctype|html)/i.test(raw);
  let html: string;
  if (isHtml) {
    const parsed = new DOMParser().parseFromString(raw, 'text/html');
    html = (parsed.querySelector('article, main') ?? parsed.body).innerHTML;
  } else {
    // Strip YAML front matter, then render GitHub-flavoured Markdown.
    html = await marked.parse(raw.replace(/^---\n[\s\S]*?\n---\n/, ''), { gfm: true, breaks: false });
  }

  const doc = new DOMParser().parseFromString(html, 'text/html');
  toTaskLists(doc);

  // Use the first H1 as the page title (and drop it from the body so it isn't repeated).
  const h1 = doc.querySelector('h1');
  const title = h1?.textContent?.trim() || file.name.replace(/\.(md|markdown|mdx|txt|html?)$/i, '');
  h1?.remove();

  return { title: title.slice(0, 255), html: cleanPastedHtml(doc.body.innerHTML) };
}

/** Import files as new pages. Returns the created page ids, in order. */
export async function importFiles(files: File[], target: { spaceId: string; parentId?: string | null }) {
  const created: { id: string; title: string }[] = [];
  for (const file of files) {
    const { title, html } = await parseImportFile(file);
    created.push(
      await api<{ id: string; title: string }>('/documents/import', {
        method: 'POST',
        json: { spaceId: target.spaceId, parentId: target.parentId ?? undefined, title, html },
      }),
    );
  }
  return created;
}
