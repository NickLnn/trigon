import { generateHTML, type JSONContent } from '@tiptap/core';
import { iconImageId, type DocumentNode } from '@trigon/shared';
import { zipSync, strToU8 } from 'fflate';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { contentExtensions } from '@/components/editor/extensions/content';
import { api, apiBlob } from './api';

/**
 * Export pages, folders, files or a whole space as Markdown or HTML.
 *
 * Markdown exports use the same layout the folder importer reads (Docmost-compatible):
 *   Title.md + Title/ for a page with sub-pages · Title/ for a folder · files/<id>.png for images ·
 *   trigon-metadata.json with icons, order, page type and tags
 * so "Export → Import folder" moves content between Trigon instances.
 */

export type ExportFormat = 'markdown' | 'html';
export interface ExportOptions {
  format: ExportFormat;
  subpages: boolean;
  attachments: boolean;
}
export interface ExportProgress {
  done: number;
  total: number;
  current: string;
}

interface PageDetail {
  title: string;
  content: JSONContent | null;
  importHtml: string | null;
  icon: string | null;
  pageType: string;
  tags: string[];
}

const IMAGE_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/avif': 'avif' };

/** Safe file/folder name: no path separators or characters Windows rejects. */
function safeName(title: string) {
  return (title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '') || 'Untitled').slice(0, 120);
}

function turndown() {
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*' });
  td.use(gfm);
  // Callouts and embeds have no Markdown form — keep them as HTML so they survive a re-import.
  td.keep((node) => node.nodeName === 'DIV' && ((node as HTMLElement).hasAttribute('data-callout') || (node as HTMLElement).hasAttribute('data-embed')));
  // Numbered "steps" lists: keep as HTML too (plain task lists become "- [ ]" items).
  td.keep((node) => node.nodeName === 'UL' && (node as HTMLElement).getAttribute('data-variant') === 'steps');
  td.addRule('fencedCodeWithLanguage', {
    filter: (node) => node.nodeName === 'PRE' && node.firstChild?.nodeName === 'CODE',
    replacement: (_c, node) => {
      const code = node.firstChild as HTMLElement;
      const lang = (code.getAttribute('class') ?? '').match(/language-(\S+)/)?.[1] ?? '';
      const text = code.textContent ?? '';
      const fence = text.includes('```') ? '````' : '```';
      return `\n\n${fence}${lang}\n${text.replace(/\n$/, '')}\n${fence}\n\n`;
    },
  });
  return td;
}

const PAGE_CSS = `body{font:16px/1.65 -apple-system,Segoe UI,Inter,sans-serif;max-width:46rem;margin:2.5rem auto;padding:0 1.25rem;color:#191c1f}
h1,h2,h3{line-height:1.25}pre{background:#0b1430;color:#dce4f7;padding:1rem;border-radius:.75rem;overflow:auto}
code{font-family:ui-monospace,Consolas,monospace}img{max-width:100%;border-radius:.6rem}table{border-collapse:collapse}
td,th{border:1px solid #dfe2e7;padding:.35rem .6rem}[data-callout]{padding:.75rem 1rem;border-radius:.75rem;background:#e6eeff}
[data-callout=warning]{background:#fff4e0}[data-callout=danger]{background:#fdecec}[data-callout=tip]{background:#e3f6ec}
nav a{color:#2f6cf2}ul.tree{list-style:none;padding-left:1.1rem}`;

const htmlPage = (title: string, body: string, back: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title.replace(/</g, '&lt;')}</title><style>${PAGE_CSS}</style></head><body><nav><a href="${back}">← Contents</a></nav><h1>${title.replace(/</g, '&lt;')}</h1>${body}</body></html>`;

export async function exportTree(
  nodes: DocumentNode[],
  opts: ExportOptions,
  meta: { name: string },
  onProgress: (p: ExportProgress) => void,
): Promise<{ blob: Blob; filename: string }> {
  const files: Record<string, Uint8Array> = {};
  const pagesMeta: Record<string, Record<string, unknown>> = {};
  const toc: string[] = [];
  const td = turndown();
  const count = (ns: DocumentNode[]): number => ns.reduce((n, x) => n + 1 + (opts.subpages ? count(x.children ?? []) : 0), 0);
  const progress: ExportProgress = { done: 0, total: count(nodes), current: '' };
  const ext = opts.format === 'markdown' ? 'md' : 'html';
  const origin = location.origin;

  /** Images → files/<id>.<ext> next to the page (or absolute links when attachments are off). */
  const localizeImages = async (html: string, dir: string) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    for (const img of Array.from(doc.querySelectorAll('img'))) {
      const src = img.getAttribute('src') ?? '';
      const m = src.match(/\/api\/files\/attachments\/([0-9a-f-]{36})/);
      if (!m) continue;
      if (!opts.attachments) {
        img.setAttribute('src', origin + src);
        continue;
      }
      try {
        const blob = await apiBlob(`/files/attachments/${m[1]}`);
        const name = `files/${m[1]}.${IMAGE_EXT[blob.type] ?? 'bin'}`;
        files[dir + name] = new Uint8Array(await blob.arrayBuffer());
        img.setAttribute('src', name);
      } catch {
        img.setAttribute('src', origin + src);
      }
    }
    // In-app links (/d/…) only work inside Trigon — make them absolute.
    doc.querySelectorAll('a[href^="/d/"]').forEach((a) => a.setAttribute('href', origin + a.getAttribute('href')));
    return doc.body.innerHTML;
  };

  const walk = async (list: DocumentNode[], dir: string, tocIndent: string) => {
    const used = new Set<string>();
    let position = 0;
    for (const node of list) {
      progress.current = node.title;
      onProgress({ ...progress });
      let name = safeName(node.title);
      for (let i = 2; used.has(name.toLowerCase()); i++) name = `${safeName(node.title)} (${i})`;
      used.add(name.toLowerCase());
      const children = opts.subpages ? (node.children ?? []) : [];
      const pos = String(position++).padStart(5, '0');

      if (node.kind === 'file') {
        if (opts.attachments) {
          const blob = await apiBlob(`/files/${node.id}/content`);
          files[dir + name] = new Uint8Array(await blob.arrayBuffer());
          toc.push(`${tocIndent}<li><a href="${encodeURI(dir + name)}">${name}</a></li>`);
        }
        progress.done++;
        continue;
      }

      const path = dir + name + '.' + ext;
      if (node.kind === 'page' || !children.length) {
        let html = '';
        let detail: PageDetail | null = null;
        if (node.kind === 'page') {
          detail = await api<PageDetail>(`/documents/${node.id}`);
          html = detail.content ? generateHTML(detail.content, contentExtensions) : (detail.importHtml ?? '');
          html = await localizeImages(html, dir);
        }
        const body = opts.format === 'markdown' ? `# ${node.title}\n\n${html ? td.turndown(html) + '\n' : ''}` : htmlPage(node.title, html, '../'.repeat(dir.split('/').length - 1) + 'index.html');
        files[path] = strToU8(body);
        pagesMeta[path.split('/').map(encodeURIComponent).join('/')] = {
          icon: node.icon && !iconImageId(node.icon) ? node.icon : null,
          position: pos,
          ...(detail ? { pageType: detail.pageType, tags: detail.tags } : {}),
        };
        toc.push(`${tocIndent}<li><a href="${encodeURI(path)}">${node.title.replace(/</g, '&lt;')}</a></li>`);
      } else {
        // Folder: only a directory — but keep its icon/order in the metadata.
        pagesMeta[(dir + name + '.' + ext).split('/').map(encodeURIComponent).join('/')] = { icon: node.icon && !iconImageId(node.icon) ? node.icon : null, position: pos };
        toc.push(`${tocIndent}<li>${node.title.replace(/</g, '&lt;')}</li>`);
      }
      progress.done++;
      if (children.length) {
        toc.push(`${tocIndent}<ul class="tree">`);
        await walk(children, dir + name + '/', tocIndent + '  ');
        toc.push(`${tocIndent}</ul>`);
      }
    }
  };

  await walk(nodes, '', '');
  progress.current = '';
  onProgress({ ...progress });

  const paths = Object.keys(files);
  // A single page without extras downloads as a plain file.
  if (paths.length === 1 && paths[0].endsWith('.' + ext)) {
    const type = opts.format === 'markdown' ? 'text/markdown' : 'text/html';
    return { blob: new Blob([files[paths[0]] as BlobPart], { type: `${type};charset=utf-8` }), filename: paths[0].split('/').pop()! };
  }

  if (opts.format === 'markdown') {
    files['trigon-metadata.json'] = strToU8(JSON.stringify({ source: 'trigon', version: 1, exportedAt: new Date().toISOString(), pages: pagesMeta }, null, 2));
  } else {
    files['index.html'] = strToU8(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${meta.name}</title><style>${PAGE_CSS}</style></head><body><h1>${meta.name}</h1><ul class="tree">${toc.join('\n')}</ul></body></html>`,
    );
  }
  const zip = zipSync(files, { level: 6 });
  const stamp = new Date().toISOString().slice(0, 10);
  return { blob: new Blob([zip as BlobPart], { type: 'application/zip' }), filename: `${safeName(meta.name)} ${opts.format === 'markdown' ? 'markdown' : 'html'} ${stamp}.zip` };
}

/** Trigger a browser download for a generated file. */
export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
