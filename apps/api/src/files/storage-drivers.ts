import { AwsClient } from 'aws4fetch';
import { createReadStream } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, statfs, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

/** Where Trigon keeps uploaded files, page images and icons. Keys are random UUIDs. */
export interface BlobStore {
  readonly driver: 'local' | 's3';
  init(): Promise<void>;
  put(key: string, data: Buffer): Promise<void>;
  read(key: string): Promise<Buffer>;
  stream(key: string): Promise<Readable>;
  remove(key: string): Promise<void>;
  list(): AsyncGenerator<{ key: string; size: number; modified: Date }>;
  /** Free/total space of the disk the files are on (null when not applicable). */
  disk(): Promise<{ freeBytes: number; totalBytes: number } | null>;
  location(): string;
  /** A path on local disk with the blob's bytes, for tools like pdftotext (cleanup removes temp copies). */
  localFile(key: string): Promise<{ path: string; cleanup: () => Promise<void> }>;
}

export const isKey = (key: string) => /^[0-9a-f-]{36}$/.test(key);
/** Relative path of a blob, the same on disk and in a bucket: two-character shard folder, then the key. */
export const blobPath = (key: string) => {
  if (!isKey(key)) throw new Error('Invalid storage key');
  return `${key.slice(0, 2)}/${key}`;
};

/** Files on this server's disk (STORAGE_DIR). */
export class LocalStore implements BlobStore {
  readonly driver = 'local' as const;
  constructor(private readonly root: string) {}

  async init() {
    await mkdir(this.root, { recursive: true });
  }

  private path(key: string) {
    return join(this.root, ...blobPath(key).split('/'));
  }

  async put(key: string, data: Buffer) {
    await mkdir(join(this.root, key.slice(0, 2)), { recursive: true });
    await writeFile(this.path(key), data);
  }

  read(key: string) {
    return readFile(this.path(key));
  }

  async stream(key: string) {
    const path = this.path(key);
    await stat(path); // a missing file fails here (404) instead of halfway through the response
    return createReadStream(path);
  }

  async remove(key: string) {
    await unlink(this.path(key)).catch(() => undefined);
  }

  async *list() {
    for (const shard of await readdir(this.root).catch(() => [] as string[])) {
      if (!/^[0-9a-f]{2}$/.test(shard)) continue;
      for (const key of await readdir(join(this.root, shard)).catch(() => [] as string[])) {
        if (!isKey(key) || key.slice(0, 2) !== shard) continue;
        const s = await stat(join(this.root, shard, key)).catch(() => null);
        if (s?.isFile()) yield { key, size: s.size, modified: s.mtime };
      }
    }
  }

  async disk() {
    const s = await statfs(this.root).catch(() => null);
    return s ? { freeBytes: s.bavail * s.bsize, totalBytes: s.blocks * s.bsize } : null;
  }

  location() {
    return this.root;
  }

  async localFile(key: string) {
    return { path: this.path(key), cleanup: async () => undefined };
  }

  /** Copy a folder laid out like this store (backup restore). */
  async importDir(dir: string) {
    await mkdir(this.root, { recursive: true });
    await cp(dir, this.root, { recursive: true, force: true });
  }
}

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** https://endpoint/bucket/key (MinIO, Synology, most self-hosted) vs https://bucket.endpoint/key. */
  pathStyle: boolean;
  /** Optional folder inside the bucket, e.g. "trigon/". */
  prefix: string;
}

const xmlDecode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Any S3-compatible object storage (AWS S3, MinIO, Backblaze B2, Wasabi, Cloudflare R2, Synology C2…). */
export class S3Store implements BlobStore {
  readonly driver = 's3' as const;
  private readonly client: AwsClient;
  private readonly base: URL;

  constructor(private readonly cfg: S3Config) {
    this.client = new AwsClient({ accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, region: cfg.region, service: 's3' });
    const endpoint = new URL(cfg.endpoint);
    this.base = cfg.pathStyle ? new URL(`${endpoint.origin}/${encodeURIComponent(cfg.bucket)}/`) : new URL(`${endpoint.protocol}//${cfg.bucket}.${endpoint.host}/`);
  }

  private url(key?: string, query?: Record<string, string>) {
    const u = new URL(key ? `${this.cfg.prefix}${blobPath(key)}` : '', this.base);
    for (const [k, v] of Object.entries(query ?? {})) u.searchParams.set(k, v);
    return u.toString();
  }

  private async call(method: string, url: string, body?: Buffer, okStatuses: number[] = []) {
    const res = await this.client.fetch(url, { method, body: body as unknown as BodyInit | undefined, headers: body ? { 'content-type': 'application/octet-stream' } : {} });
    if (!res.ok && !okStatuses.includes(res.status)) {
      const text = await res.text().catch(() => '');
      const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1];
      const err = new Error(`S3 ${method} failed: ${res.status}${code ? ` ${code}` : ''}`) as Error & { code?: string };
      if (res.status === 404) err.code = 'ENOENT';
      throw err;
    }
    return res;
  }

  /** Check the bucket is reachable with these credentials (list one object). */
  async init() {
    await this.call('GET', this.url(undefined, { 'list-type': '2', 'max-keys': '1', prefix: this.cfg.prefix }));
  }

  async put(key: string, data: Buffer) {
    await this.call('PUT', this.url(key), data);
  }

  async read(key: string) {
    const res = await this.call('GET', this.url(key));
    return Buffer.from(await res.arrayBuffer());
  }

  async stream(key: string) {
    const res = await this.call('GET', this.url(key));
    return Readable.fromWeb(res.body as never);
  }

  async remove(key: string) {
    await this.call('DELETE', this.url(key), undefined, [404]);
  }

  /** Size of a stored blob, or null if it isn't there. */
  async head(key: string): Promise<number | null> {
    const res = await this.call('HEAD', this.url(key), undefined, [404]);
    return res.status === 404 ? null : Number(res.headers.get('content-length') ?? 0);
  }

  async *list() {
    let token: string | undefined;
    do {
      const query: Record<string, string> = { 'list-type': '2', prefix: this.cfg.prefix, 'max-keys': '1000' };
      if (token) query['continuation-token'] = token;
      const xml = await (await this.call('GET', this.url(undefined, query))).text();
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const name = xmlDecode(/<Key>([^<]*)<\/Key>/.exec(m[1])?.[1] ?? '').slice(this.cfg.prefix.length);
        const key = name.split('/').pop() ?? '';
        if (!isKey(key) || name !== blobPath(key)) continue;
        yield {
          key,
          size: Number(/<Size>(\d+)<\/Size>/.exec(m[1])?.[1] ?? 0),
          modified: new Date(/<LastModified>([^<]+)<\/LastModified>/.exec(m[1])?.[1] ?? 0),
        };
      }
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? xmlDecode(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1] ?? '') || undefined : undefined;
    } while (token);
  }

  async disk() {
    return null;
  }

  location() {
    return `${this.cfg.bucket}${this.cfg.prefix ? `/${this.cfg.prefix.replace(/\/$/, '')}` : ''} at ${new URL(this.cfg.endpoint).host}`;
  }

  async localFile(key: string) {
    const dir = await mkdtemp(join(tmpdir(), 'trigon-blob-'));
    const path = join(dir, key);
    await writeFile(path, await this.read(key));
    return { path, cleanup: () => rm(dir, { recursive: true, force: true }) };
  }

  /** Upload a folder laid out like a local store (backup restore). */
  async importDir(dir: string) {
    for (const shard of await readdir(dir).catch(() => [] as string[])) {
      if (!/^[0-9a-f]{2}$/.test(shard)) continue;
      for (const key of await readdir(join(dir, shard))) if (isKey(key)) await this.put(key, await readFile(join(dir, shard, key)));
    }
  }
}

/** Storage settings from the environment (STORAGE_DRIVER=s3 plus S3_*), or null for local disk. */
export function s3ConfigFromEnv(env: (k: string) => string | undefined): S3Config | null {
  if ((env('STORAGE_DRIVER') ?? 'local').toLowerCase() !== 's3') return null;
  const need = (k: string) => {
    const v = env(k)?.trim();
    if (!v) throw new Error(`STORAGE_DRIVER=s3 needs ${k}`);
    return v;
  };
  const prefix = (env('S3_PREFIX') ?? '').trim().replace(/^\/+/, '');
  return {
    endpoint: need('S3_ENDPOINT'),
    region: env('S3_REGION')?.trim() || 'us-east-1',
    bucket: need('S3_BUCKET'),
    accessKeyId: need('S3_ACCESS_KEY_ID'),
    secretAccessKey: need('S3_SECRET_ACCESS_KEY'),
    pathStyle: (env('S3_PATH_STYLE') ?? 'true').toLowerCase() !== 'false',
    prefix: prefix && !prefix.endsWith('/') ? `${prefix}/` : prefix,
  };
}
