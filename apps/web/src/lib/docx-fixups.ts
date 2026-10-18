/**
 * Work-arounds for docx-preview (0.4.x) layout gaps, so Word files look like they do in Word:
 *
 * Before rendering (XML of the .docx):
 *  - table indent: Word writes <w:tblInd w:w="…"/>, docx-preview only reads w:start/w:left — a table
 *    pulled into the margin (common in footers with logo rows) ran off the page;
 *  - fixed table layout: Word writes <w:tblLayout w:type="fixed"/>, docx-preview reads w:val;
 *  - fonts: a run that only names an East-Asian / complex-script font (w:eastAsia) was drawn in that font
 *    (often Times New Roman), where Word keeps the inherited Latin font;
 *  - "different first page" without a first-page header/footer: Word shows none on that page,
 *    docx-preview fell back to the normal one (logos and addresses on the cover).
 *
 * After rendering (the HTML):
 *  - fonts that aren't installed fall back to a matching generic family instead of the browser's serif;
 *  - floating text boxes (VML) carry Word's huge z-index values, so a title "in front of" a picture
 *    ended up behind it; text boxes are lifted above the page content.
 */

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
/** Stand-ins for the PAGE / NUMPAGES field results, replaced with real numbers after rendering. */
export const PAGE_MARK = '\u2063PAGE\u2063';
export const PAGES_MARK = '\u2063NUMPAGES\u2063';
const EMPTY_HEADER = 'trigonEmptyHeader';
const EMPTY_FOOTER = 'trigonEmptyFooter';

/** Fixes applied to a WordprocessingML part (document, headers, footers, notes). */
export function fixPartXml(xml: string): string {
  return (
    xml
      // <w:tblInd w:w="-1560" w:type="dxa"/> → also w:start, which docx-preview understands (twips).
      .replace(/<w:tblInd\b([^>]*?)\/>/g, (tag, attrs: string) => {
        const w = /\bw:w="(-?\d+)"/.exec(attrs)?.[1];
        const type = /\bw:type="(\w+)"/.exec(attrs)?.[1] ?? 'dxa';
        if (!w || type !== 'dxa' || /\bw:(start|left)=/.test(attrs)) return tag;
        return `<w:tblInd${attrs} w:start="${w}"/>`;
      })
      // <w:tblLayout w:type="fixed"/> → also w:val.
      .replace(/<w:tblLayout\b([^>]*?)\/>/g, (tag, attrs: string) => {
        const type = /\bw:type="(\w+)"/.exec(attrs)?.[1];
        return type && !/\bw:val=/.test(attrs) ? `<w:tblLayout${attrs} w:val="${type}"/>` : tag;
      })
      // A run font that only names the East-Asian font: Latin text keeps the inherited font, as in Word.
      .replace(/<w:rFonts\b([^>]*?)\/>/g, (tag, attrs: string) =>
        /\bw:ascii(Theme)?=/.test(attrs) ? tag : `<w:rFonts${attrs.replace(/\s+w:eastAsia="[^"]*"/g, '')}/>`,
      )
  );
}

/**
 * Headers and footers keep the PAGE / NUMPAGES result Word last saved (the same number on every page).
 * Replace those results with markers that fixRenderedDocx turns into each page's real number.
 */
export function markPageFields(xml: string): string {
  // Complex fields: begin … instrText " PAGE " … separate … <w:t>3</w:t> … end
  let out = xml.replace(
    /(<w:instrText\b[^>]*>\s*(PAGE|NUMPAGES)\b[^<]*<\/w:instrText>[\s\S]*?w:fldCharType="separate"[\s\S]*?)(<w:t\b[^>]*>)[^<]*(<\/w:t>)([\s\S]*?w:fldCharType="end")/g,
    (_m, head: string, kind: string, open: string, close: string, tail: string) =>
      `${head}${open}${kind === 'PAGE' ? PAGE_MARK : PAGES_MARK}${close}${tail.replace(/(<w:t\b[^>]*>)[^<]*(<\/w:t>)/g, '$1$2')}`,
  );
  // Simple fields: <w:fldSimple w:instr=" PAGE "><w:r><w:t>3</w:t></w:r></w:fldSimple>
  out = out.replace(/(<w:fldSimple\b[^>]*w:instr="\s*(PAGE|NUMPAGES)\b[^"]*"[^>]*>[\s\S]*?<w:t\b[^>]*>)[^<]*(<\/w:t>)/g, (_m, head: string, kind: string, close: string) =>
    `${head}${kind === 'PAGE' ? PAGE_MARK : PAGES_MARK}${close}`,
  );
  return out;
}

/** The first page number from <w:pgNumType w:start="…"/> (Word starts at 1 unless told otherwise). */
export function firstPageNumber(documentXml: string): number {
  const start = /<w:pgNumType\b[^>]*w:start="(-?\d+)"/.exec(documentXml)?.[1];
  return start === undefined ? 1 : Number(start);
}

/**
 * Sections with "different first page" (w:titlePg) but no first-page header/footer get references to
 * empty ones, which is what Word shows. Returns the new document XML and whether parts must be added.
 */
export function addEmptyFirstPageRefs(documentXml: string): { xml: string; header: boolean; footer: boolean } {
  let header = false;
  let footer = false;
  const xml = documentXml.replace(/<w:sectPr\b[^>]*>[\s\S]*?<\/w:sectPr>/g, (sect) => {
    if (!/<w:titlePg(\s*\/>|\s+w:val="(1|true|on)")/.test(sect)) return sect;
    let out = sect;
    const open = /^<w:sectPr\b[^>]*>/.exec(out)![0];
    if (!/<w:headerReference\b[^>]*w:type="first"/.test(out)) {
      out = out.replace(open, `${open}<w:headerReference w:type="first" r:id="${EMPTY_HEADER}"/>`);
      header = true;
    }
    if (!/<w:footerReference\b[^>]*w:type="first"/.test(out)) {
      // Footer references follow header references in the schema.
      const lastHeader = [...out.matchAll(/<w:headerReference\b[^>]*\/>/g)].pop();
      const at = lastHeader ? lastHeader.index! + lastHeader[0].length : open.length;
      out = `${out.slice(0, at)}<w:footerReference w:type="first" r:id="${EMPTY_FOOTER}"/>${out.slice(at)}`;
      footer = true;
    }
    return out;
  });
  return { xml, header, footer };
}

export interface PreparedDocx {
  blob: Blob;
  /** Number of the first page (pgNumType start), for the PAGE fields. */
  firstPage: number;
}

/** Apply the XML fixes to a .docx (the original is returned unchanged if anything fails). */
export async function prepareDocx(file: Blob): Promise<PreparedDocx> {
  let firstPage = 1;
  try {
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(file);
    const parts = Object.keys(zip.files).filter((n) => /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(n));
    for (const name of parts) {
      const xml = fixPartXml(await zip.file(name)!.async('string'));
      zip.file(name, /^word\/(header|footer)/.test(name) ? markPageFields(xml) : xml);
    }

    const doc = zip.file('word/document.xml');
    const rels = zip.file('word/_rels/document.xml.rels');
    const types = zip.file('[Content_Types].xml');
    if (doc && rels && types) {
      const documentXml = await doc.async('string');
      firstPage = firstPageNumber(documentXml);
      const { xml, header, footer } = addEmptyFirstPageRefs(documentXml);
      if (header || footer) {
        let relsXml = await rels.async('string');
        let typesXml = await types.async('string');
        const add = (id: string, kind: 'header' | 'footer') => {
          const part = `trigon-empty-${kind}.xml`;
          const root = kind === 'header' ? 'w:hdr' : 'w:ftr';
          zip.file(`word/${part}`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><${root} xmlns:w="${W_NS}"><w:p/></${root}>`);
          relsXml = relsXml.replace(
            '</Relationships>',
            `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${kind}" Target="${part}"/></Relationships>`,
          );
          typesXml = typesXml.replace(
            '</Types>',
            `<Override PartName="/word/${part}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml"/></Types>`,
          );
        };
        if (header) add(EMPTY_HEADER, 'header');
        if (footer) add(EMPTY_FOOTER, 'footer');
        zip.file('word/document.xml', xml);
        zip.file('word/_rels/document.xml.rels', relsXml);
        zip.file('[Content_Types].xml', typesXml);
      }
    }
    return { blob: await zip.generateAsync({ type: 'blob' }), firstPage };
  } catch (err) {
    console.warn('Could not adjust the document before rendering; showing it as is.', err);
    return { blob: file, firstPage };
  }
}

const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-[a-z-]+|inherit|initial|unset)$/i;
const SERIF = /times|cambria|georgia|garamond|book antiqua|palatino|constantia|serif/i;
const MONO = /courier|consolas|mono|lucida console/i;

/** A CSS font-family list with a matching generic family at the end (for fonts that aren't installed). */
export function withFallback(family: string): string {
  const fonts = family.split(',').map((f) => f.trim()).filter(Boolean);
  if (!fonts.length || GENERIC.test(fonts[fonts.length - 1].replace(/['"]/g, ''))) return family;
  const first = fonts[0].replace(/['"]/g, '');
  const generic = MONO.test(first) ? 'monospace' : SERIF.test(first) ? 'serif' : 'sans-serif';
  return `${fonts.join(', ')}, ${generic}`;
}

/** Fix-ups on the rendered HTML (call after renderAsync). */
export function fixRenderedDocx(body: HTMLElement, styles: HTMLElement | null, opts: { firstPage?: number } = {}) {
  // Real page numbers in headers and footers (each rendered page is a section.docx).
  const pages = [...body.querySelectorAll<HTMLElement>('section.docx')];
  pages.forEach((page, i) => {
    const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeValue?.includes('\u2063')) {
        node.nodeValue = node.nodeValue.replaceAll(PAGE_MARK, String((opts.firstPage ?? 1) + i)).replaceAll(PAGES_MARK, String(pages.length));
      }
    }
  });
  // Field results such as table-of-contents entries are links; Word draws them in the text's own style
  // (styled hyperlinks keep their colour from their run style), not in the browser's blue underline.
  if (styles && !styles.querySelector('style[data-trigon]')) {
    const css = document.createElement('style');
    css.dataset.trigon = '';
    css.textContent = '.docx a { color: inherit; text-decoration: inherit; }';
    styles.append(css);
  }
  // Generated stylesheet and inline styles: add fallbacks to every font-family.
  for (const style of styles?.querySelectorAll('style') ?? []) {
    style.textContent = (style.textContent ?? '').replace(/font-family:\s*([^;}]+)/g, (_m, fam: string) => `font-family: ${withFallback(fam.trim())}`);
  }
  for (const el of body.querySelectorAll<HTMLElement>('[style*="font-family"]')) {
    el.style.fontFamily = withFallback(el.style.fontFamily);
  }
  for (const el of body.querySelectorAll<SVGElement>('svg[style*="position:absolute"], svg[style*="position: absolute"]')) {
    const raw = el.getAttribute('style') ?? '';
    // Read Word's anchoring before touching the style (unknown mso-* properties are dropped on rewrite).
    const vertical = /mso-position-vertical-relative:\s*([a-z-]+)/i.exec(raw)?.[1] ?? 'text';
    const horizontal = /mso-position-horizontal-relative:\s*([a-z-]+)/i.exec(raw)?.[1] ?? 'text';
    const style = (el as unknown as HTMLElement).style;
    // Offsets (margin-left / margin-top) count from the anchoring paragraph, as in Word — not from wherever
    // the shape happens to sit in the text flow (after a full-page picture, that's the next page).
    const paragraph = el.closest('p');
    if (paragraph && /^(text|paragraph|line|char)$/i.test(vertical) && /^(text|margin|char|column)$/i.test(horizontal)) {
      paragraph.style.position = 'relative';
      style.top = '0';
      style.left = '0';
    }
    // Text boxes in front of the pictures they belong to (Word's ±251658240 z-index range).
    const z = Number(style.zIndex);
    if (Number.isFinite(z) && Math.abs(z) >= 100_000) {
      const hasText = !!el.querySelector('foreignObject, foreignobject') && !!el.textContent?.trim();
      style.zIndex = hasText ? '2' : z < 0 ? '0' : '1';
    }
  }
}
