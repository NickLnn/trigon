import { BadRequestException } from '@nestjs/common';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';

/** Everything that isn't the public Internet: loopback, private, link-local, CGNAT, documentation, multicast… */
const BLOCKED = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  BLOCKED.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b:1::', 48], // local-use NAT64
  ['100::', 64], // discard
  ['2001::', 32], // Teredo (embeds an obfuscated IPv4)
  ['2001:db8::', 32], // documentation
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (deprecated)
  ['ff00::', 8], // multicast
] as const) {
  BLOCKED.addSubnet(net, prefix, 'ipv6');
}

/** The 16 bytes of an IPv6 address (accepts `::` shorthand and a trailing dotted IPv4), or null. */
function ipv6Bytes(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  const dotted = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number);
    s = `${s.slice(0, -dotted[0].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const groups = halves.length === 2 ? [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail] : head;
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.flatMap((g) => [parseInt(g, 16) >> 8, parseInt(g, 16) & 0xff]);
}

/** IPv4 address carried inside an IPv6 one (mapped, compatible, NAT64, 6to4), or null. */
function embeddedIpv4(bytes: number[]): string | null {
  const v4 = (o: number) => bytes.slice(o, o + 4).join('.');
  const zero = (from: number, to: number) => bytes.slice(from, to).every((b) => b === 0);
  if (zero(0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) return v4(12); // ::ffff:a.b.c.d
  if (zero(0, 12)) return v4(12); // ::a.b.c.d (deprecated "compatible")
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && zero(4, 12)) return v4(12); // 64:ff9b::/96
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return v4(2); // 2002::/16 (6to4)
  return null;
}

/** Whether an address must never be fetched from the server: anything not on the public Internet. */
export function isPrivateAddress(ip: string): boolean {
  const bare = ip.replace(/^\[|\]$/g, '');
  const family = isIP(bare);
  if (family === 4) return BLOCKED.check(bare, 'ipv4');
  if (family !== 6) return true; // not an IP address at all: refuse rather than guess
  const bytes = ipv6Bytes(bare);
  if (!bytes) return true;
  const v4 = embeddedIpv4(bytes);
  if (v4 && BLOCKED.check(v4, 'ipv4')) return true;
  return BLOCKED.check(bare.split('%')[0], 'ipv6');
}

const ssrfError = () => new BadRequestException('URL resolves to a non-public address');

/**
 * Validate a user-supplied URL before the server fetches it (oEmbed unfurling, image import, icons):
 * http(s) only, and the host must resolve only to public addresses. safeFetch() additionally pins the
 * connection to the checked addresses, so a DNS answer that changes in between (rebinding) can't win.
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
  const addresses = isIP(host) ? [host] : await lookup(host, { all: true }).then((r) => r.map((a) => a.address), () => []);
  if (!addresses.length) throw new BadRequestException('Could not resolve the address');
  if (addresses.some(isPrivateAddress)) throw ssrfError();
  return url;
}

/**
 * DNS lookup used for the actual connection: resolves again and refuses if any answer is non-public.
 * Since the socket connects to exactly the address returned here, the check and the connection agree.
 */
export function publicOnlyLookup(
  hostname: string,
  options: { all?: boolean },
  callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
) {
  dnsLookup(hostname, { all: true }, (err, list) => {
    if (err) return callback(err, '', 0);
    if (!list.length || list.some((a) => isPrivateAddress(a.address))) {
      return callback(Object.assign(new Error('URL resolves to a non-public address'), { code: 'ESSRF' }), '', 0);
    }
    if (options.all) callback(null, list);
    else callback(null, list[0].address, list[0].family);
  });
}

interface Fetched {
  status: number;
  location: string | null;
  contentType: string;
  body: Buffer;
}

/** One GET with the pinned lookup, a timeout and a streaming size cap (also when no Content-Length is sent). */
function get(url: URL, opts: { maxBytes: number; timeoutMs: number; accept: string }): Promise<Fetched> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(
      url,
      {
        method: 'GET',
        agent: false,
        lookup: publicOnlyLookup as never,
        signal: AbortSignal.timeout(opts.timeoutMs),
        headers: { 'user-agent': 'TrigonBot/0.1 (+https://github.com/NickLnn/trigon)', accept: opts.accept, 'accept-encoding': 'identity' },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const header = (name: string) => {
          const v = res.headers[name];
          return (Array.isArray(v) ? v[0] : v) ?? null;
        };
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({ status, location: header('location'), contentType: '', body: Buffer.alloc(0) });
        }
        if (Number(header('content-length') ?? 0) > opts.maxBytes) {
          req.destroy();
          return reject(new BadRequestException('Remote file too large'));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > opts.maxBytes) {
            req.destroy();
            reject(new BadRequestException('Remote file too large'));
          } else chunks.push(chunk);
        });
        res.on('end', () => resolve({ status, location: null, contentType: header('content-type') ?? 'application/octet-stream', body: Buffer.concat(chunks) }));
        res.on('error', reject);
      },
    );
    req.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ESSRF') reject(ssrfError());
      else if (err instanceof BadRequestException) reject(err);
      else reject(new BadRequestException(`Could not fetch the URL (${err.code ?? err.name})`));
    });
    req.end();
  });
}

/** Fetch a user-supplied URL: public addresses only (checked per redirect hop and pinned), timeout and size cap. */
export async function safeFetch(raw: string, opts: { maxBytes: number; timeoutMs?: number; accept?: string }) {
  let current = raw;
  for (let hop = 0; hop < 4; hop++) {
    const url = await assertPublicUrl(current);
    const res = await get(url, { maxBytes: opts.maxBytes, timeoutMs: opts.timeoutMs ?? 8000, accept: opts.accept ?? '*/*' });
    if (res.status >= 300 && res.status < 400 && res.location) {
      current = new URL(res.location, url).toString();
      continue;
    }
    if (res.status < 200 || res.status >= 300) throw new BadRequestException(`Upstream responded ${res.status}`);
    return { buffer: res.body, contentType: res.contentType, finalUrl: url };
  }
  throw new BadRequestException('Too many redirects');
}
