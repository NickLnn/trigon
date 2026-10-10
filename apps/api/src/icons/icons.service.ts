import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { safeFetch } from '../common/ssrf';
import { Database, InjectDb } from '../db/db.module';
import { icons } from '../db/schema';
import { StorageService } from '../files/storage.service';

const IMAGE = /^image\/(png|x-icon|vnd\.microsoft\.icon|svg\+xml|webp|jpeg|gif|avif)$/;
const MAX_ICON_BYTES = 1024 * 1024;

interface Candidate {
  url: string;
  /** Larger is better; SVG ranks highest. */
  score: number;
}

/** Normalise "https://www.vmware.com/foo" / "vmware.com" → "vmware.com". */
export function normaliseDomain(input: string): string {
  let host = input.trim().toLowerCase();
  try {
    host = new URL(host.includes('://') ? host : `https://${host}`).hostname;
  } catch {
    throw new BadRequestException('Not a valid domain');
  }
  host = host.replace(/^www\./, '');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) throw new BadRequestException('Not a valid domain');
  return host;
}

/** Find icon links in a page's <head>, best first. */
export function iconCandidates(html: string, base: URL): Candidate[] {
  const out: Candidate[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = tag.match(/\brel=["']([^"']+)["']/i)?.[1].toLowerCase() ?? '';
    if (!/(^|\s)(icon|apple-touch-icon|apple-touch-icon-precomposed|mask-icon)(\s|$)/.test(rel)) continue;
    const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1];
    if (!href || href.startsWith('data:')) continue;
    let url: string;
    try {
      url = new URL(href.replace(/&amp;/g, '&'), base).toString();
    } catch {
      continue;
    }
    const sizes = tag.match(/\bsizes=["']([^"']+)["']/i)?.[1] ?? '';
    const largest = Math.max(0, ...sizes.split(/\s+/).map((s) => parseInt(s, 10) || 0));
    const isSvg = /\.svg(\?|$)/i.test(url) || /image\/svg/i.test(tag);
    // mask-icon SVGs are single-colour silhouettes — usable, but rank below real artwork.
    const score = rel.includes('mask-icon') ? 40 : isSvg ? 1000 : rel.includes('apple-touch') ? Math.max(largest, 180) : largest || 32;
    out.push({ url, score });
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Fetches and stores original vendor favicons (best available: SVG > apple-touch-icon > largest
 * <link rel=icon> > /favicon.ico) and user-uploaded icon images.
 */
@Injectable()
export class IconsService {
  private readonly logger = new Logger(IconsService.name);
  private inFlight = new Map<string, Promise<string>>();
  /** Domains whose last fetch found nothing (so the picker stops waiting); retried after an hour. */
  private failed = new Map<string, number>();

  hasFailed(domain: string) {
    const at = this.failed.get(domain);
    return !!at && Date.now() - at < 3_600_000;
  }

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly storage: StorageService,
  ) {}

  async findByDomain(domain: string) {
    const [row] = await this.db.select().from(icons).where(eq(icons.domain, domain));
    return row;
  }

  /** Returns the icon id for a domain, fetching it the first time. Concurrent calls share one fetch. */
  fetchForDomain(input: string, name?: string, userId?: string, iconUrl?: string): Promise<string> {
    const domain = normaliseDomain(input);
    const pending = this.inFlight.get(domain);
    if (pending) return pending;
    const job = this.doFetch(domain, name ?? domain, userId, iconUrl)
      .then((id) => {
        this.failed.delete(domain);
        return id;
      })
      .catch((err) => {
        this.failed.set(domain, Date.now());
        throw err;
      })
      .finally(() => this.inFlight.delete(domain));
    this.inFlight.set(domain, job);
    return job;
  }

  private async tryImage(url: string) {
    try {
      const { buffer, contentType } = await safeFetch(url, { maxBytes: MAX_ICON_BYTES, timeoutMs: 8000, accept: 'image/*' });
      let mime = contentType.split(';')[0].trim().toLowerCase();
      if (mime === 'application/octet-stream' || mime === 'text/plain') {
        if (/\.ico(\?|$)/i.test(url)) mime = 'image/x-icon';
        else if (/\.png(\?|$)/i.test(url)) mime = 'image/png';
        else if (/\.svg(\?|$)/i.test(url)) mime = 'image/svg+xml';
      }
      if (!IMAGE.test(mime) || buffer.length < 100) return null;
      if (mime === 'image/svg+xml' && !/<svg[\s>]/i.test(buffer.toString('utf8', 0, 2000))) return null;
      return { buffer, mime };
    } catch {
      return null;
    }
  }

  private async doFetch(domain: string, name: string, userId?: string, iconUrl?: string): Promise<string> {
    const existing = await this.findByDomain(domain);
    if (existing) return existing.id;

    // A pinned official logo wins over whatever the website advertises.
    const candidates: Candidate[] = iconUrl ? [{ url: iconUrl, score: 100_000 }] : [];
    for (const origin of [`https://${domain}`, `https://www.${domain}`]) {
      try {
        const page = await safeFetch(origin, { maxBytes: 1024 * 1024, timeoutMs: 8000, accept: 'text/html' });
        candidates.push(...iconCandidates(page.buffer.toString('utf8'), page.finalUrl));
        if (candidates.length > (iconUrl ? 1 : 0)) break;
      } catch {
        /* try the next origin */
      }
    }
    candidates.push(
      { url: `https://${domain}/apple-touch-icon.png`, score: 180 },
      { url: `https://${domain}/favicon.svg`, score: 900 },
      { url: `https://${domain}/favicon.ico`, score: 16 },
    );
    candidates.sort((a, b) => b.score - a.score);

    for (const c of candidates) {
      const img = await this.tryImage(c.url);
      if (!img) continue;
      const storageKey = await this.storage.put(img.buffer);
      const [row] = await this.db
        .insert(icons)
        .values({ name, domain, storageKey, mimeType: img.mime, sizeBytes: img.buffer.length, createdById: userId })
        .onConflictDoNothing()
        .returning({ id: icons.id });
      if (row) return row.id;
      return (await this.findByDomain(domain))!.id;
    }
    this.logger.warn(`No usable icon found for ${domain}`);
    throw new BadRequestException(`Couldn't find an icon on ${domain}`);
  }

  async upload(name: string, buffer: Buffer, mime: string, userId: string) {
    if (!IMAGE.test(mime)) throw new BadRequestException('Use a PNG, SVG, ICO, WebP or JPEG image');
    if (buffer.length > MAX_ICON_BYTES) throw new BadRequestException('Icons must be under 1 MB');
    const storageKey = await this.storage.put(buffer);
    const [row] = await this.db
      .insert(icons)
      .values({ name: name.slice(0, 120) || 'Custom icon', storageKey, mimeType: mime, sizeBytes: buffer.length, createdById: userId })
      .returning({ id: icons.id });
    return row.id;
  }
}
