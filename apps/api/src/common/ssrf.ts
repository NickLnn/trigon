import { BadRequestException } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::') return true;
    if (v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')) return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateAddress(mapped[1]) : false;
  }
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

/**
 * Validate a user-supplied URL before the server fetches it (oEmbed unfurling, image import).
 * Blocks non-http(s) schemes and hosts that resolve to private/loopback ranges.
 */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BadRequestException('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BadRequestException('Only http(s) URLs');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((r) => r.address);
  if (!addresses.length || addresses.some(isPrivateAddress)) {
    throw new BadRequestException('URL resolves to a non-public address');
  }
  return url;
}

/** fetch() with a timeout, size cap and no automatic redirects to unchecked hosts. */
export async function safeFetch(raw: string, opts: { maxBytes: number; timeoutMs?: number; accept?: string }) {
  let current = raw;
  for (let hop = 0; hop < 4; hop++) {
    const url = await assertPublicUrl(current);
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
      headers: { 'user-agent': 'TrigonBot/0.1 (+https://github.com/NickLnn/trigon)', accept: opts.accept ?? '*/*' },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location')!, url).toString();
      continue;
    }
    if (!res.ok) throw new BadRequestException(`Upstream responded ${res.status}`);
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > opts.maxBytes) throw new BadRequestException('Remote file too large');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > opts.maxBytes) throw new BadRequestException('Remote file too large');
    return { buffer: buf, contentType: res.headers.get('content-type') ?? 'application/octet-stream', finalUrl: url };
  }
  throw new BadRequestException('Too many redirects');
}
