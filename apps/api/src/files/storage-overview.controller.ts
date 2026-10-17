import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import type { StorageLeftovers, StorageOverview } from '@trigon/shared';
import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ActivityService } from '../activity/activity.service';
import { BACKUP_NAME } from '../backups/destinations';
import { CurrentUser, Roles, type AuthUser } from '../common/decorators';
import { Database, InjectDb } from '../db/db.module';
import { trashDays } from '../documents/trash.controller';
import { attachments, documents, documentVersions, icons, spaces } from '../db/schema';
import { SettingsService } from '../settings/settings.service';
import { StorageService } from './storage.service';

/** A blob has to be this old before it can count as a leftover (an upload writes the file just before its row). */
const LEFTOVER_MIN_AGE_MS = 24 * 60 * 60 * 1000;

/** Settings → Storage: what takes space, the biggest files, and leftovers nothing refers to. */
@Controller('settings/storage')
@Roles('admin')
export class StorageOverviewController {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly storage: StorageService,
    private readonly settings: SettingsService,
    private readonly activity: ActivityService,
  ) {}

  @Get()
  async overview(): Promise<StorageOverview> {
    const n = (v: unknown) => Number(v ?? 0);
    const [files] = await this.db
      .select({ count: sql<number>`count(*)`, bytes: sql<number>`coalesce(sum(${documents.sizeBytes}), 0)` })
      .from(documents)
      .where(and(eq(documents.kind, 'file'), isNull(documents.deletedAt)));
    const [images] = await this.db
      .select({ count: sql<number>`count(*)`, bytes: sql<number>`coalesce(sum(${attachments.sizeBytes}), 0)` })
      .from(attachments)
      .innerJoin(documents, eq(documents.id, attachments.documentId))
      .where(isNull(documents.deletedAt));
    // Trash: deleted files plus the images of deleted pages (both are removed when the trash is emptied).
    const [trashFiles] = await this.db
      .select({ items: sql<number>`count(*) filter (where ${documents.kind} <> 'folder')`, bytes: sql<number>`coalesce(sum(${documents.sizeBytes}), 0)` })
      .from(documents)
      .where(isNotNull(documents.deletedAt));
    const [trashImages] = await this.db
      .select({ bytes: sql<number>`coalesce(sum(${attachments.sizeBytes}), 0)` })
      .from(attachments)
      .innerJoin(documents, eq(documents.id, attachments.documentId))
      .where(isNotNull(documents.deletedAt));
    const [history] = await this.db
      .select({
        versions: sql<number>`count(*)`,
        bytes: sql<number>`coalesce(sum(octet_length(${documentVersions.ydoc}) + coalesce(octet_length(${documentVersions.content}::text), 0) + octet_length(${documentVersions.textContent})), 0)`,
      })
      .from(documentVersions);
    const [{ dbBytes }] = (await this.db.execute<{ dbBytes: string }>(sql`select pg_database_size(current_database()) as "dbBytes"`)).rows;
    const largest = await this.db
      .select({ id: documents.id, title: documents.title, mimeType: documents.mimeType, spaceName: spaces.name, sizeBytes: documents.sizeBytes })
      .from(documents)
      .innerJoin(spaces, eq(spaces.id, documents.spaceId))
      .where(and(eq(documents.kind, 'file'), isNull(documents.deletedAt), isNotNull(documents.sizeBytes)))
      .orderBy(desc(documents.sizeBytes))
      .limit(10);
    const perSpace = (
      await this.db.execute<{ id: string; name: string; bytes: string; files: string }>(sql`
        select s.id, s.name,
               coalesce((select sum(d.size_bytes) from ${documents} d where d.space_id = s.id and d.kind = 'file' and d.deleted_at is null), 0)
             + coalesce((select sum(a.size_bytes) from ${attachments} a join ${documents} d on d.id = a.document_id where d.space_id = s.id and d.deleted_at is null), 0) as bytes,
               (select count(*) from ${documents} d where d.space_id = s.id and d.kind = 'file' and d.deleted_at is null) as files
        from ${spaces} s
        order by bytes desc, s.name`)
    ).rows;

    return {
      storage: this.storage.describe(),
      disk: await this.storage.disk(),
      files: { count: n(files.count), bytes: n(files.bytes) },
      pageImages: { count: n(images.count), bytes: n(images.bytes) },
      trash: { items: n(trashFiles.items), bytes: n(trashFiles.bytes) + n(trashImages.bytes), purgeDays: trashDays() },
      database: { bytes: n(dbBytes), historyBytes: n(history.bytes), versions: n(history.versions) },
      backups: await this.localBackups(),
      largest: largest.map((f) => ({ ...f, sizeBytes: n(f.sizeBytes) })),
      spaces: perSpace.map((s) => ({ id: s.id, name: s.name, bytes: n(s.bytes), files: n(s.files) })),
    };
  }

  /** Backups in the "This server" folder, if that destination is in use. */
  private async localBackups(): Promise<StorageOverview['backups']> {
    const s = await this.settings.get('backup');
    if (!s.destinations.includes('local')) return null;
    let count = 0;
    let bytes = 0;
    try {
      for (const name of await readdir(s.localPath)) {
        if (!BACKUP_NAME.test(name)) continue;
        const st = await stat(join(s.localPath, name)).catch(() => null);
        if (st?.isFile()) {
          count++;
          bytes += st.size;
        }
      }
    } catch {
      return null;
    }
    return { count, bytes, location: s.localPath };
  }

  /** Every blob key the database refers to. */
  private async referenced(): Promise<Set<string>> {
    const rows = await this.db.execute<{ key: string }>(sql`
      select storage_key as key from ${documents} where storage_key is not null
      union select storage_key from ${attachments}
      union select storage_key from ${icons}`);
    return new Set(rows.rows.map((r) => r.key));
  }

  private async leftovers() {
    const keep = await this.referenced();
    const cutoff = Date.now() - LEFTOVER_MIN_AGE_MS;
    const found: { key: string; size: number }[] = [];
    for await (const blob of this.storage.list()) {
      if (!keep.has(blob.key) && blob.modified.getTime() < cutoff) found.push(blob);
    }
    return found;
  }

  /** Look for stored files nothing refers to (reads the whole storage folder, so on demand only). */
  @Post('leftovers')
  @HttpCode(200)
  async scan(): Promise<StorageLeftovers> {
    const found = await this.leftovers();
    return { count: found.length, bytes: found.reduce((n, b) => n + b.size, 0), scannedAt: new Date().toISOString() };
  }

  /** Delete those leftovers. Re-checks right before deleting, so nothing still referenced is touched. */
  @Post('leftovers/clean')
  @HttpCode(200)
  async clean(@CurrentUser() user: AuthUser): Promise<StorageLeftovers & { removed: number }> {
    const found = await this.leftovers();
    for (const blob of found) await this.storage.remove(blob.key);
    const bytes = found.reduce((n, b) => n + b.size, 0);
    if (found.length) {
      this.activity.record({ action: 'storage.cleaned', actorId: user.id, target: { type: 'settings', id: null, name: 'Storage' }, details: { itemsDeleted: found.length, sizeBytes: bytes } });
    }
    return { removed: found.length, count: 0, bytes, scannedAt: new Date().toISOString() };
  }
}
