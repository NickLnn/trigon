import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { LocalStore, S3Store, s3ConfigFromEnv, type BlobStore } from './storage-drivers';

/**
 * Blob storage for uploaded files, page images and icons: this server's disk (STORAGE_DIR, the default)
 * or any S3-compatible bucket (STORAGE_DRIVER=s3 with S3_*). Keys are random UUIDs, laid out the same
 * way in both (xx/<uuid>), so files can be copied from one to the other.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private store: BlobStore;

  constructor(private readonly config: ConfigService) {
    const s3 = s3ConfigFromEnv((k) => this.config.get<string>(k));
    this.store = s3 ? new S3Store(s3) : new LocalStore(resolve(this.config.get('STORAGE_DIR') ?? './storage'));
  }

  async onModuleInit() {
    try {
      await this.store.init();
      if (this.store.driver === 's3') this.logger.log(`Files are stored in S3: ${this.store.location()}`);
    } catch (err) {
      // Start anyway (pages and settings still work) but make the problem obvious in the logs.
      this.logger.error(`File storage (${this.store.driver}) is not reachable: ${(err as Error).message}`);
    }
  }

  async put(data: Buffer): Promise<string> {
    const key = randomUUID();
    await this.store.put(key, data);
    return key;
  }

  /** The blob as a stream (for responses). Rejects if it doesn't exist. */
  stream(key: string): Promise<Readable> {
    return this.store.stream(key);
  }

  read(key: string): Promise<Buffer> {
    return this.store.read(key);
  }

  async remove(key: string) {
    await this.store.remove(key).catch(() => undefined);
  }

  /** Run `fn` with the blob as a file on local disk (S3 blobs are downloaded to a temp file and removed after). */
  async withLocalFile<T>(key: string, fn: (path: string) => Promise<T>): Promise<T> {
    const { path, cleanup } = await this.store.localFile(key);
    try {
      return await fn(path);
    } finally {
      await cleanup().catch(() => undefined);
    }
  }

  /** Every stored blob (for the storage overview's leftover check). */
  list() {
    return this.store.list();
  }

  /** Free and total space of the disk the files are on (null for S3). */
  disk() {
    return this.store.disk();
  }

  /** Where files are kept, for display. */
  describe() {
    return { driver: this.store.driver, location: this.store.location() };
  }

  /** Local folder backups pack up, or null when files live in S3 (backups then hold the database only). */
  localRoot(): string | null {
    return this.store.driver === 'local' ? this.store.location() : null;
  }

  /** Put the files from a restored backup's storage folder back. */
  importDir(dir: string) {
    return (this.store as LocalStore | S3Store).importDir(dir);
  }
}
