import type { DocumentNode } from '@trigon/shared';
import { unzipSync } from 'fflate';
import { marked } from 'marked';
import { api } from './api';
import { cleanPastedHtml } from './html-clean';

/**
 * Bulk import of a folder tree of Markdown/HTML pages — a Docmost export, a Trigon export, or any
 * folder of .md files. The structure becomes the page tree:
 *
 *   Microsoft.md + Microsoft/…   → one item "Microsoft" with its sub-pages inside
 *   a page with only a title     → a folder
 *   files/<id>/image.png         → uploaded and embedded in the page that references it
 *   other referenced files       → uploaded as files next to the page (PDF, video…)
 *
 * Items whose title already exists at the same place are reused (containers) or skipped (pages),
 * so an export merges into an existing tree instead of duplicating it.
 */

export interface ImportEntry {
  path: string;
  file: Blob;
}

interface Meta {
  icon?: string | null;
  position?: string;
}

interface Node {
  key: string;
  name: string;
  md?: Blob;
  file?: Blob;
  meta: Meta;
  children: Node[];
}

export interface ImportProgress {
  total: number;
  done: number;
  current: string;
  created: number;
  merged: number;
  skipped: number;
  uploads: number;
  errors: string[];
}

const PAGE_EXT = /\.(md|markdown|html?)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif)$/i;
const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif',
  pdf: 'application/pdf', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', zip: 'application/zip', txt: 'text/plain',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

const ext = (p: string) => p.toLowerCase().split('.').pop() ?? '';
const dirname = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const norm = (s: string) => s.trim().toLowerCase();

/** Resolve "files/x.png" or "../a/b.md" relative to a page's directory. */
function resolve(fromDir: string, ref: string): string {
  const parts = (fromDir ? fromDir.split('/') : []).concat(decodeURIComponent(ref.split(/[?#]/)[0]).split('/'));
  const out: string[] = [];
  for (const p of parts) {
    if (!p || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out.join('/');
}

/** Read a picked folder (webkitdirectory) or a .zip into path → blob entries with a common root removed. */
export async function readImportSource(files: File[]): Promise<ImportEntry[]> {
  let entries: ImportEntry[] = [];
  for (const f of files) {
    if (/\.zip$/i.test(f.name) && files.length === 1) {
      const unzipped = unzipSync(new Uint8Array(await f.arrayBuffer()));
      for (const [raw, data] of Object.entries(unzipped)) {
        // Windows' built-in "Compress" can write backslash separators.
        const path = raw.replace(/\\/g, '/');
        if (!path.endsWith('/')) entries.push({ path, file: new Blob([data as BlobPart], { type: MIME[ext(path)] ?? '' }) });
      }
    } else {
      entries.push({ path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name, file: f });
    }
  }
  entries = entries.filter((e) => !/(^|\/)(\.DS_Store|Thumbs\.db|__MACOSX\/.*)$/.test(e.path));
  // Strip a shared top folder (the folder the user picked / the zip's wrapper folder).
  const firsts = new Set(entries.map((e) => (e.path.includes('/') ? e.path.split('/')[0] : '')));
  if (firsts.size === 1 && !firsts.has('')) {
    const root = [...firsts][0] + '/';
    const hasRootPage = entries.some((e) => e.path === root.slice(0, -1) + '.md');
    if (!hasRootPage) entries = entries.map((e) => ({ ...e, path: e.path.slice(root.length) }));
  }
  return entries;
}

function buildTree(entries: ImportEntry[], meta: Record<string, Meta>): Node[] {
  const byKey = new Map<string, Node>();
  const ensure = (key: string): Node => {
    let n = byKey.get(key);
    if (!n) {
      n = { key, name: basename(key), meta: meta[key] ?? {}, children: [] };
      byKey.set(key, n);
      const parentKey = dirname(key);
      if (parentKey) ensure(parentKey).children.push(n);
    }
    return n;
  };
  for (const e of entries) {
    const segments = e.path.split('/');
    if (segments.slice(0, -1).includes('files')) continue; // attachments, handled per page
    if (/^(docmost|trigon)-metadata\.json$/.test(e.path)) continue;
    if (PAGE_EXT.test(e.path)) ensure(e.path.replace(PAGE_EXT, '')).md = e.file;
    else ensure(e.path).file = e.file;
  }
  const sort = (list: Node[]) => {
    list.sort((a, b) => (a.meta.position ?? '￿').localeCompare(b.meta.position ?? '￿') || a.name.localeCompare(b.name));
    list.forEach((n) => sort(n.children));
  };
  const roots = [...byKey.values()].filter((n) => !dirname(n.key));
  sort(roots);
  return roots;
}

function readMeta(entries: ImportEntry[]): Promise<Record<string, Meta>> {
  const metaFile = entries.find((e) => /^(docmost|trigon)-metadata\.json$/.test(e.path));
  if (!metaFile) return Promise.resolve({});
  return metaFile.file.text().then((t) => {
    const out: Record<string, Meta> = {};
    try {
      const pages = (JSON.parse(t).pages ?? {}) as Record<string, Meta>;
      for (const [k, v] of Object.entries(pages)) out[decodeURIComponent(k).replace(PAGE_EXT, '')] = { icon: v.icon ?? null, position: v.position };
    } catch {
      /* ignore malformed metadata */
    }
    return out;
  });
}

const PLACEHOLDER = 'https://trigon-import.invalid/';

/** Markdown/HTML → title + clean HTML, with local file references replaced by numbered placeholders. */
async function convert(node: Node, files: Map<string, Blob>) {
  const raw = await node.md!.text();
  const isHtml = /^\s*<(!doctype|html|body)/i.test(raw);
  const html = isHtml ? raw : await marked.parse(raw.replace(/^---\n[\s\S]*?\n---\n/, ''), { gfm: true });
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const dir = dirname(node.key);
  const refs: { path: string; image: boolean }[] = [];
  const local = (url: string | null) => !!url && !/^([a-z]+:|#|\/\/)/i.test(url) && files.has(resolve(dir, url));
  doc.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src');
    if (local(src)) {
      refs.push({ path: resolve(dir, src!), image: true });
      img.setAttribute('src', PLACEHOLDER + (refs.length - 1));
    }
  });
  doc.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href');
    if (local(href)) {
      const path = resolve(dir, href!);
      refs.push({ path, image: IMAGE_EXT.test(path) });
      a.setAttribute('href', PLACEHOLDER + (refs.length - 1));
    }
  });
  // Task lists rendered by marked → Tiptap task lists.
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
  const h1 = doc.querySelector('h1');
  const title = (h1?.textContent?.trim() || node.name).slice(0, 255);
  h1?.remove();
  const body = cleanPastedHtml(doc.body.innerHTML);
  const empty = !body.replace(/<[^>]+>/g, '').replace(/&nbsp;| |\s/g, '') && !/<(img|pre|table|hr)\b/i.test(body);
  return { title, html: body, refs, empty };
}

export async function importTree(
  entries: ImportEntry[],
  target: { spaceId: string; parentId: string | null },
  onProgress: (p: ImportProgress) => void,
): Promise<ImportProgress> {
  const files = new Map(entries.map((e) => [e.path, e.file]));
  const roots = buildTree(entries, await readMeta(entries));
  const count = (ns: Node[]): number => ns.reduce((n, x) => n + 1 + count(x.children), 0);
  const p: ImportProgress = { total: count(roots), done: 0, current: '', created: 0, merged: 0, skipped: 0, uploads: 0, errors: [] };
  const tick = () => onProgress({ ...p, errors: [...p.errors] });

  const existingTree = await api<DocumentNode[]>(`/spaces/${target.spaceId}/tree`);
  const findNode = (nodes: DocumentNode[], id: string): DocumentNode | null => {
    for (const n of nodes) {
      if (n.id === id) return n;
      const inner = findNode(n.children ?? [], id);
      if (inner) return inner;
    }
    return null;
  };
  const findChildren = (nodes: DocumentNode[], id: string | null) => (id ? (findNode(nodes, id)?.children ?? []) : nodes);

  const uploadAttachment = async (pageId: string, path: string) => {
    const blob = files.get(path)!;
    const form = new FormData();
    form.append('documentId', pageId);
    form.append('file', new File([blob], basename(path), { type: blob.type || MIME[ext(path)] || 'application/octet-stream' }));
    return (await api<{ url: string }>('/files/attachments', { method: 'POST', body: form })).url;
  };
  const uploadFile = async (parentId: string | null, path: string, blob: Blob) => {
    const form = new FormData();
    form.append('spaceId', target.spaceId);
    if (parentId) form.append('parentId', parentId);
    form.append('file', new File([blob], basename(path), { type: blob.type || MIME[ext(path)] || 'application/octet-stream' }));
    return api<{ id: string }>('/files', { method: 'POST', body: form });
  };

  const walk = async (nodes: Node[], parentId: string | null, existing: DocumentNode[]) => {
    for (const node of nodes) {
      p.current = node.key;
      tick();
      try {
        if (node.file && !node.md) {
          // Loose file in the tree (not referenced from a page).
          if (existing.some((e) => norm(e.title) === norm(node.name))) p.skipped++;
          else {
            await uploadFile(parentId, node.key, node.file);
            p.uploads++;
            p.created++;
          }
          p.done++;
          continue;
        }

        const conv = node.md ? await convert(node, files) : { title: node.name, html: '', refs: [], empty: true };
        const isContainer = node.children.length > 0;
        const match = existing.find((e) => norm(e.title) === norm(conv.title) && e.kind !== 'file');

        let id: string;
        if (match && (isContainer || conv.empty)) {
          id = match.id; // merge into the existing folder/page
          p.merged++;
        } else if (match) {
          p.skipped++; // same page already there — don't duplicate or overwrite it
          p.done++;
          continue;
        } else if (conv.empty && isContainer) {
          id = (await api<{ id: string }>('/documents', { method: 'POST', json: { spaceId: target.spaceId, parentId: parentId ?? undefined, kind: 'folder', title: conv.title, icon: node.meta.icon ?? undefined } })).id;
          p.created++;
        } else {
          id = (
            await api<{ id: string }>('/documents/import', {
              method: 'POST',
              json: { spaceId: target.spaceId, parentId: parentId ?? undefined, title: conv.title, html: conv.refs.length ? '<p></p>' : conv.html, icon: node.meta.icon ?? undefined },
            })
          ).id;
          p.created++;
          if (conv.refs.length) {
            let html = conv.html;
            for (let i = 0; i < conv.refs.length; i++) {
              const ref = conv.refs[i];
              const url = ref.image ? await uploadAttachment(id, ref.path) : `/d/${(await uploadFile(id, ref.path, files.get(ref.path)!)).id}`;
              html = html.split(PLACEHOLDER + i).join(url);
              p.uploads++;
              tick();
            }
            await api(`/documents/${id}/import-html`, { method: 'PUT', json: { html } });
          }
        }
        p.done++;
        tick();
        if (node.children.length) await walk(node.children, id, match ? (match.children ?? []) : []);
      } catch (err) {
        p.errors.push(`${node.key}: ${(err as Error).message}`);
        p.done += 1 + count(node.children);
        tick();
      }
    }
  };

  await walk(roots, target.parentId, findChildren(existingTree, target.parentId));
  p.current = '';
  tick();
  return p;
}
