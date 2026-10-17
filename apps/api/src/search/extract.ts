import { inflateRawSync } from 'node:zlib';

/** Text kept per file (same cap the editor uses for text files). */
export const MAX_TEXT = 1_000_000;
/** Never inflate more than this from one zip entry (guards against zip bombs). */
const MAX_ENTRY = 50 * 1024 * 1024;

export type FileKind = 'text' | 'pdf' | 'image' | 'docx' | 'xlsx' | 'pptx' | 'odf' | 'vsdx' | null;

const EXT_KIND: Record<string, FileKind> = {
  pdf: 'pdf',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  tif: 'image',
  tiff: 'image',
  webp: 'image',
  bmp: 'image',
  docx: 'docx',
  docm: 'docx',
  xlsx: 'xlsx',
  xlsm: 'xlsx',
  pptx: 'pptx',
  pptm: 'pptx',
  odt: 'odf',
  ods: 'odf',
  odp: 'odf',
  vsdx: 'vsdx',
  vsdm: 'vsdx',
};

/** Which reader handles a file, from its name (MIME types from browsers are unreliable). */
export function fileKind(title: string, mimeType: string | null, isText: boolean): FileKind {
  if (isText) return 'text';
  const ext = title.toLowerCase().split('.').pop() ?? '';
  if (EXT_KIND[ext]) return EXT_KIND[ext];
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType && /^image\/(png|jpeg|tiff|webp|bmp)$/.test(mimeType)) return 'image';
  return null;
}

/** Collapse whitespace runs (keeping line breaks and the form feeds between PDF pages) and cap the length. */
export function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n\f]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n*\f\n*/g, '\f')
    .replace(/\n{3,}/g, '\n\n')
    // Not .trim(): leading form feeds (blank first pages) must stay, or page numbers shift.
    .replace(/^[ \n]+|[ \n]+$/g, '')
    .slice(0, MAX_TEXT);
}

/** Entries of a zip archive (central directory only; no extra dependencies). */
export function readZip(buf: Buffer): Map<string, () => Buffer> {
  const entries = new Map<string, () => Buffer>();
  // End of central directory: signature 0x06054b50, within the last 64 KB + 22 bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    entries.set(name, () => {
      if (size > MAX_ENTRY) throw new Error(`${name} is too large`);
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + compressed);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data, { maxOutputLength: MAX_ENTRY });
      throw new Error(`Unsupported zip compression (${method})`);
    });
  }
  return entries;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

/** Text of an Office XML part: `pattern` captures text runs in group 1; any other match is a break or a tab. */
function runs(xml: string, pattern: RegExp): string {
  let out = '';
  for (const m of xml.matchAll(pattern)) out += m[1] !== undefined ? decodeXml(m[1]) : /tab/.test(m[0]) ? ' ' : '\n';
  return out;
}

const byNumber = (a: string, b: string) => Number(a.match(/(\d+)\.xml$/)?.[1] ?? 0) - Number(b.match(/(\d+)\.xml$/)?.[1] ?? 0);

/** Plain text of a .docx / .xlsx / .pptx / OpenDocument file. */
export function officeText(buf: Buffer, kind: 'docx' | 'xlsx' | 'pptx' | 'odf' | 'vsdx'): string {
  const zip = readZip(buf);
  const part = (name: string) => zip.get(name)?.().toString('utf8') ?? '';
  const names = [...zip.keys()];
  if (kind === 'docx') {
    const parts = ['word/document.xml', ...names.filter((n) => /^word\/(header|footer|footnotes|endnotes)\d*\.xml$/.test(n))];
    return parts.map((n) => runs(part(n), /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<\/w:p>|<w:br\b[^>]*\/>|<w:tab\b[^>]*\/>/g)).join('\n');
  }
  if (kind === 'pptx') {
    const slides = names.filter((n) => /^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/.test(n)).sort(byNumber);
    return slides.map((n) => runs(part(n), /<a:t>([^<]*)<\/a:t>|<\/a:p>|<a:br\b[^>]*\/>/g)).join('\n\n');
  }
  if (kind === 'xlsx') {
    // Cell text lives in the shared strings table; sheet names help too.
    const sheets = [...part('xl/workbook.xml').matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map((m) => decodeXml(m[1]));
    return sheets.join('\n') + '\n' + runs(part('xl/sharedStrings.xml'), /<t(?:\s[^>]*)?>([^<]*)<\/t>|<\/si>/g);
  }
  if (kind === 'vsdx') return visioText(part, names);
  // OpenDocument: mixed content in content.xml.
  return decodeXml(
    part('content.xml')
      .replace(/<\/text:(p|h)>|<text:line-break\/>/g, '\n')
      .replace(/<text:(tab|s)\b[^>]*\/>/g, ' ')
      .replace(/<[^>]+>/g, ''),
  );
}

/**
 * Visio (.vsdx): page names, the text of every shape, and shape data values (e.g. a server's
 * IP address or asset tag), page by page.
 */
function visioText(part: (name: string) => string, names: string[]): string {
  // Visio writes attributes in single quotes; accept either.
  const pageNames = [...part('visio/pages/pages.xml').matchAll(/<Page\b[^>]*?\sName=(['"])(.*?)\1/g)].map((m) => decodeXml(m[2]));
  const pages = names.filter((n) => /^visio\/pages\/page\d+\.xml$/.test(n)).sort(byNumber);
  const out: string[] = [];
  pages.forEach((n, i) => {
    const xml = part(n);
    const lines: string[] = [];
    if (pageNames[i]) lines.push(pageNames[i]);
    // Shape text: mixed content with formatting markers (<cp/>, <pp/>, <tp/>, <fld>…</fld>).
    for (const m of xml.matchAll(/<Text(?:\s[^>]*)?>([\s\S]*?)<\/Text>/g)) {
      const t = decodeXml(m[1].replace(/<[^>]+>/g, '')).trim();
      if (t) lines.push(t);
    }
    // Shape data rows: <Section N="Property"><Row N="IP"><Cell N="Value" V="10.0.0.5" …/>
    for (const sec of xml.matchAll(/<Section N=(['"])Property\1>([\s\S]*?)<\/Section>/g)) {
      for (const v of sec[2].matchAll(/<Cell N=(['"])Value\1 V=(['"])(.*?)\2/g)) {
        const t = decodeXml(v[3]).trim();
        if (t && !/^(0|1|TRUE|FALSE)$/i.test(t)) lines.push(t);
      }
    }
    out.push(lines.join('\n'));
  });
  return out.join('\n\n');
}
