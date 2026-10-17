import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, stat, statfs, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';

/**
 * Local-disk blob storage. Keys are random UUIDs sharded into two-char directories.
 * Swap for an S3-compatible implementation later without touching callers.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private root: string;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    this.root = resolve(this.config.get('STORAGE_DIR') ?? './storage');
    await mkdir(this.root, { recursive: true });
  }

  /** Where a blob lives on disk (read-only use, e.g. handing a PDF to pdftotext). */
  pathFor(key: string) {
    if (!/^[0-9a-f-]{36}$/.test(key)) throw new Error('Invalid storage key');
    return join(this.root, key.slice(0, 2), key);
  }

  async put(data: Buffer): Promise<string> {
    const key = randomUUID();
    const path = this.pathFor(key);
    await mkdir(join(this.root, key.slice(0, 2)), { recursive: true });
    await writeFile(path, data);
    return key;
  }

  stream(key: string) {
    return createReadStream(this.pathFor(key));
  }

  read(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  async remove(key: string) {
    await unlink(this.pathFor(key)).catch(() => undefined);
  }

  /** Every stored blob (for the storage overview's leftover check). */
  async *list(): AsyncGenerator<{ key: string; size: number; modified: Date }> {
    for (const shard of await readdir(this.root).catch(() => [] as string[])) {
      if (!/^[0-9a-f]{2}$/.test(shard)) continue;
      for (const key of await readdir(join(this.root, shard)).catch(() => [] as string[])) {
        if (!/^[0-9a-f-]{36}$/.test(key) || key.slice(0, 2) !== shard) continue;
        const s = await stat(join(this.root, shard, key)).catch(() => null);
        if (s?.isFile()) yield { key, size: s.size, modified: s.mtime };
      }
    }
  }

  /** Free and total space of the disk the files are on. */
  async disk(): Promise<{ freeBytes: number; totalBytes: number } | null> {
    const s = await statfs(this.root).catch(() => null);
    return s ? { freeBytes: s.bavail * s.bsize, totalBytes: s.blocks * s.bsize } : null;
  }

  /** Where files are kept, for display. */
  describe() {
    return { driver: 'local' as const, location: this.root };
  }
}
