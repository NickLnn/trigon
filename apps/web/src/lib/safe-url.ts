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
