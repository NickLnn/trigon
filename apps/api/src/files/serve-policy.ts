/** Types that are safe to show inline: the browser renders them without running anything from the file. */
const SAFE_INLINE = /^(application\/pdf|image\/(png|jpeg|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon)|video\/(mp4|webm|ogg|quicktime)|audio\/(mpeg|ogg|wav|webm|mp4|aac|flac)|text\/plain)$/;

/** Types a browser would execute as script or as an active document in Trigon's origin. */
const ACTIVE = /(html|javascript|ecmascript|^text\/xml$|^application\/xml$|\+xml$|^text\/xsl|^application\/x-sh|^text\/vtt$|^multipart\/)/;

/**
 * Response headers for an uploaded file. The MIME type comes from the uploader's browser and can be
 * anything, so:
 *  - active types (HTML, XHTML, XML, JavaScript…) are sent as application/octet-stream — never rendered,
 *    and never usable as a <script src> under nosniff. SVG keeps its type (so <img> previews work) but is
 *    downloaded, not rendered, when opened directly;
 *  - only PDFs, raster images, audio/video and plain text are shown inline; everything else downloads;
 *  - a sandbox CSP (no scripts, no same-origin) applies to everything except PDFs, whose built-in browser
 *    viewer a sandbox (or the API's default-src 'none') would block.
 */
export function fileResponseHeaders(mimeType: string | null | undefined, fileName: string): Record<string, string> {
  const mime = (mimeType ?? '').split(';')[0].trim().toLowerCase() || 'application/octet-stream';
  const svg = mime === 'image/svg+xml';
  const type = ACTIVE.test(mime) && !svg ? 'application/octet-stream' : mime;
  const inline = SAFE_INLINE.test(type);
  return {
    'Content-Type': type === 'text/plain' ? 'text/plain; charset=utf-8' : type,
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin',
    // PDFs get a policy of their own (replacing the API default) that leaves the browser's PDF viewer working.
    'Content-Security-Policy':
      type === 'application/pdf' ? "frame-ancestors 'self'" : "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox",
  };
}
