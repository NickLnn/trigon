import DOMPurify from 'dompurify';

const ALLOWED_TAGS = [
  'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
  'strong', 'b', 'em', 'i', 'u', 's', 'del', 'strike', 'mark', 'sub', 'sup',
  'a', 'img', 'figure', 'figcaption',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'div', 'span', 'section', 'article', 'main',
  'input', 'label',
];
const ALLOWED_ATTR = ['href', 'src', 'alt', 'title', 'class', 'data-language', 'data-type', 'data-checked', 'data-variant', 'data-callout', 'data-embed', 'data-url', 'data-title', 'type', 'checked', 'colspan', 'rowspan', 'start'];

/** Pull a language hint from common highlighter class conventions (Prism, hljs, GitHub, MDN…). */
function languageFromClasses(el: Element | null): string | null {
  for (let node = el; node; node = node.parentElement) {
    const cls = node.getAttribute('class') ?? '';
    const lang = node.getAttribute('data-lang') ?? node.getAttribute('data-language');
    if (lang) return lang.toLowerCase();
    const m = cls.match(/(?:^|\s)(?:language|lang|highlight-source|brush:?)-?([\w+#-]+)/i);
    if (m) return m[1].toLowerCase().replace(/^js$/, 'javascript').replace(/^ts$/, 'typescript').replace(/^sh$/, 'bash');
    if (node.tagName === 'PRE' || node.tagName === 'BODY') break;
  }
  return null;
}

/**
 * Web-clipper normalisation for HTML pasted from other sites:
 *  - strips scripts, styles, event handlers, tracking pixels and layout cruft (DOMPurify)
 *  - rebuilds code samples as <pre><code class="language-x"> with real newlines, so syntax-
 *    highlighted markup (one <span> per token, <br> or <div> per line) becomes clean code blocks
 *  - absolutises image/link URLs against the source page when the clipboard provides it
 *  - unwraps layout <div>/<span>/<section> so ProseMirror sees the document flow
 */
export function cleanPastedHtml(html: string, sourceUrl?: string | null): string {
  if (typeof window === 'undefined') return html;

  const sanitized = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: [...ALLOWED_ATTR, 'data-lang'],
    ALLOW_DATA_ATTR: false,
    RETURN_DOM: true,
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'button', 'svg', 'nav', 'footer', 'aside'],
  }) as HTMLElement;

  const base = sourceUrl ?? sanitized.ownerDocument.baseURI;

  // Code samples first, while their highlighter classes are still present.
  sanitized.querySelectorAll('pre').forEach((pre) => {
    const code = pre.querySelector('code');
    const language = languageFromClasses(code) ?? languageFromClasses(pre);
    // Line-per-element highlighters: turn block children and <br> into newlines.
    pre.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
    pre.querySelectorAll('div, p').forEach((d) => d.append('\n'));
    // Strip line-number gutters.
    pre.querySelectorAll('.line-number, .lineno, .gutter, .linenos, [aria-hidden="true"]').forEach((n) => n.remove());
    const text = (code ?? pre).textContent?.replace(/\n{3,}$/g, '\n').replace(/\n$/, '') ?? '';
    const fresh = pre.ownerDocument.createElement('pre');
    const freshCode = pre.ownerDocument.createElement('code');
    if (language) freshCode.className = `language-${language}`;
    freshCode.textContent = text;
    fresh.appendChild(freshCode);
    pre.replaceWith(fresh);
  });

  sanitized.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') ?? '';
    // 1×1 trackers and data: blobs too large to be worth keeping inline
    if (!src || (img.getAttribute('width') === '1' && img.getAttribute('height') === '1')) {
      img.remove();
      return;
    }
    try {
      if (!src.startsWith('data:')) img.setAttribute('src', new URL(src, base).toString());
    } catch {
      img.remove();
    }
  });

  sanitized.querySelectorAll('a[href]').forEach((a) => {
    try {
      const href = new URL(a.getAttribute('href')!, base);
      if (href.protocol === 'http:' || href.protocol === 'https:' || href.protocol === 'mailto:') a.setAttribute('href', href.toString());
      else a.removeAttribute('href');
    } catch {
      a.removeAttribute('href');
    }
  });

  // Drop presentation classes now that code languages have been captured.
  sanitized.querySelectorAll('[class]').forEach((el) => {
    if (!(el.tagName === 'CODE' && el.parentElement?.tagName === 'PRE')) el.removeAttribute('class');
  });

  // Unwrap pure layout containers (keeps their children in place).
  sanitized.querySelectorAll('span, section, article, main').forEach((el) => el.replaceWith(...Array.from(el.childNodes)));

  return sanitized.innerHTML;
}

/** Many browsers put the source page URL in a leading comment or a `text/x-moz-url` entry. */
export function sourceUrlFromClipboard(data: DataTransfer | null): string | null {
  if (!data) return null;
  const moz = data.getData('text/x-moz-url-priv') || data.getData('text/x-moz-url');
  if (moz) return moz.split('\n')[0];
  const html = data.getData('text/html');
  const m = html.match(/<!--\s*SourceURL:\s*(\S+)\s*-->/i) ?? html.match(/<base\s+href=["']([^"']+)["']/i);
  return m?.[1] ?? null;
}
