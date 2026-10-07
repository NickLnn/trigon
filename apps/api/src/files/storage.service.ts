import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
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

  private pathFor(key: string) {
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

  async remove(key: string) {
    await unlink(this.pathFor(key)).catch(() => undefined);
  }
}
