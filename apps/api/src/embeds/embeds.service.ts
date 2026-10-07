import { Injectable } from '@nestjs/common';
import { matchEmbedProvider, type EmbedInfo } from '@trigon/shared';
import { safeFetch } from '../common/ssrf';

const decode = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();

/** Extract an Open Graph / Twitter / <title> value from raw HTML without a DOM. */
export function readMeta(html: string, names: string[]): string | null {
  for (const name of names) {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`,
      'i',
    );
    const m = html.match(re);
    if (m) return decode(m[1] ?? m[2]);
  }
  return null;
}

/** Turns a pasted URL into embed metadata: oEmbed for known video hosts, Open Graph otherwise. */
@Injectable()
export class EmbedsService {
  private cache = new Map<string, { at: number; info: EmbedInfo }>();

  async unfurl(raw: string): Promise<EmbedInfo> {
    const hit = this.cache.get(raw);
    if (hit && Date.now() - hit.at < 3_600_000) return hit.info;
    const info = await this.resolve(raw);
    if (this.cache.size > 1000) this.cache.clear();
    this.cache.set(raw, { at: Date.now(), info });
    return info;
  }

  private async resolve(raw: string): Promise<EmbedInfo> {
    const match = matchEmbedProvider(raw);
    if (match) {
      const base: EmbedInfo = {
        url: raw,
        provider: match.provider,
        type: 'video',
        title: null,
        description: null,
        thumbnailUrl: null,
        embedUrl: match.embedUrl,
        width: 16,
        height: 9,
      };
      try {
        const { buffer } = await safeFetch(match.oembedEndpoint, { maxBytes: 256 * 1024, accept: 'application/json' });
        const o = JSON.parse(buffer.toString('utf8')) as Record<string, unknown>;
        return {
          ...base,
          title: (o.title as string) ?? null,
          description: (o.description as string) ?? null,
          thumbnailUrl: (o.thumbnail_url as string) ?? null,
          width: Number(o.width) || 16,
          height: Number(o.height) || 9,
        };
      } catch {
        return base; // the iframe still works without metadata
      }
    }

    const { buffer, contentType, finalUrl } = await safeFetch(raw, { maxBytes: 1024 * 1024, accept: 'text/html' });
    if (contentType.startsWith('image/')) {
      return { url: raw, provider: finalUrl.hostname, type: 'photo', title: null, description: null, thumbnailUrl: raw, embedUrl: null, width: null, height: null };
    }
    const html = buffer.toString('utf8');
    const titleTag = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1];
    const image = readMeta(html, ['og:image', 'twitter:image']);
    return {
      url: raw,
      provider: readMeta(html, ['og:site_name']) ?? finalUrl.hostname.replace(/^www\./, ''),
      type: 'link',
      title: readMeta(html, ['og:title', 'twitter:title']) ?? (titleTag ? decode(titleTag) : null),
      description: readMeta(html, ['og:description', 'twitter:description', 'description']),
      thumbnailUrl: image ? new URL(image, finalUrl).toString() : null,
      embedUrl: null,
      width: null,
      height: null,
    };
  }
}
