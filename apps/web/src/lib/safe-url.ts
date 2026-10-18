import { matchEmbedProvider } from '@trigon/shared';

/** The value when it is an absolute http(s) URL, else null (blocks javascript:, data:, relative paths…). */
export function webUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * What an embed node may show. Its attributes travel through the live document and any collaborator can
 * set them, so the stored player URL is ignored: it is rebuilt from the link, for the allow-listed video
 * hosts only. Never same-origin, never a script URL.
 */
export function embedTarget(rawUrl: string | null | undefined): { url: string | null; embedUrl: string | null } {
  const url = webUrl(rawUrl);
  return { url, embedUrl: url ? (matchEmbedProvider(url)?.embedUrl ?? null) : null };
}

/** A link target resolved against `base`: http(s) or mailto only, else null. */
export function safeHref(raw: string | null | undefined, base?: string | null): string | null {
  if (!raw) return null;
  try {
    const u = base ? new URL(raw, base) : new URL(raw);
    return ['http:', 'https:', 'mailto:'].includes(u.protocol) ? u.toString() : null;
  } catch {
    return null;
  }
}

/** An image source: http(s) resolved against `base`, or an inline raster/SVG `data:image/…` URL; else null. */
export function safeImageSrc(raw: string | null | undefined, base?: string | null): string | null {
  if (!raw) return null;
  if (/^data:/i.test(raw)) return /^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml)[;,]/i.test(raw) ? raw : null;
  try {
    const u = base ? new URL(raw, base) : new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}
