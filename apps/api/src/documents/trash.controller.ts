import { Controller, Delete, Get, Injectable, Logger, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { atLeast, type TrashItem } from '@trigon/shared';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { ActivityService } from '../activity/activity.service';
import { CurrentUser, type AuthUser } from '../common/decorators';
import { Database, InjectDb } from '../db/db.module';
import { attachments, documents, spaces, users } from '../db/schema';
import { StorageService } from '../files/storage.service';
import { PermissionsService } from '../permissions/permissions.service';

/** Days an item stays in the trash before it is deleted for good (TRASH_RETENTION_DAYS, default 30). */
export const trashDays = () => Math.max(1, Number(process.env.TRASH_RETENTION_DAYS ?? 30) || 30);

/**
 * Removing for good: rows (versions, attachments, review requests cascade) and the stored blobs of the
 * files and pasted images inside.
 */
@Injectable()
export class TrashService {
  private readonly logger = new Logger(TrashService.name);

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly storage: StorageService,
  ) {}

  /** The item and everything deleted together with it. */
  async subtree(id: string): Promise<string[]> {
    const rows = await this.db.execute<{ id: string }>(sql`
      WITH RECURSIVE sub AS (
        SELECT id, deleted_at FROM ${documents} WHERE id = ${id} AND deleted_at IS NOT NULL
        UNION ALL
        SELECT d.id, d.deleted_at FROM ${documents} d JOIN sub ON d.parent_id = sub.id WHERE d.deleted_at = sub.deleted_at
      ) SELECT id FROM sub`);
    return rows.rows.map((r) => r.id);
  }

  async purge(roots: string[]) {
    if (!roots.length) return;
    // Deleting a row also deletes everything under it (FK cascade), so collect the blobs of the whole subtree.
    const all = await this.db.execute<{ id: string }>(sql`
      WITH RECURSIVE sub AS (
        SELECT id FROM ${documents} WHERE id IN ${roots}
        UNION ALL SELECT d.id FROM ${documents} d JOIN sub ON d.parent_id = sub.id
      ) SELECT DISTINCT id FROM sub`);
    const ids = all.rows.map((r) => r.id);
    const blobs = [
      ...(await this.db.select({ key: documents.storageKey }).from(documents).where(and(inArray(documents.id, ids), isNotNull(documents.storageKey)))).map((r) => r.key!),
      ...(await this.db.select({ key: attachments.storageKey }).from(attachments).where(inArray(attachments.documentId, ids))).map((r) => r.key),
    ];
    await this.db.delete(documents).where(inArray(documents.id, ids));
    for (const key of blobs) await this.storage.remove(key).catch(() => undefined);
  }

  /** Nightly: empty everything that has been in the trash longer than the retention period. */
  @Cron('30 3 * * *')
  async purgeExpired() {
    const expired = await this.db.execute<{ id: string }>(sql`
      SELECT id FROM ${documents} WHERE deleted_at IS NOT NULL AND deleted_at < now() - make_interval(days => ${trashDays()})`);
    const ids = expired.rows.map((r) => r.id);
    if (!ids.length) return;
    await this.purge(ids);
    this.logger.log(`Emptied ${ids.length} item(s) older than ${trashDays()} days from the trash.`);
  }
}

/** A space's trash: list, restore, delete for good. */
@Controller()
export class TrashController {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly perms: PermissionsService,
    private readonly trash: TrashService,
    private readonly activity: ActivityService,
  ) {}

  /** Trash of one space. */
  @Get('spaces/:id/trash')
  async list(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) spaceId: string): Promise<TrashItem[]> {
    await this.perms.assertSpace(user, spaceId, 'edit');
    return this.items([spaceId]);
  }

  /** Trash of every space the user can edit (sidebar → Trash). */
  @Get('trash')
  async all(@CurrentUser() user: AuthUser): Promise<TrashItem[]> {
    if (user.role === 'admin') return this.items(null);
    const levels = await this.perms.spaceLevels(user);
    const editable = [...levels].filter(([, level]) => atLeast(level, 'edit')).map(([id]) => id);
    return editable.length ? this.items(editable) : [];
  }

  /** Top-level deleted items (things deleted with their folder are listed under it, not separately). */
  private async items(spaceIds: string[] | null): Promise<TrashItem[]> {
    const rows = await this.db.execute<{
      id: string;
      title: string;
      kind: TrashItem['kind'];
      icon: string | null;
      mime_type: string | null;
      page_type: TrashItem['pageType'];
      deleted_at: Date;
      deleted_by: string | null;
      location: string | null;
      inside: number;
      space_id: string;
      space_name: string;
    }>(sql`
      SELECT d.id, d.title, d.kind, d.icon, d.mime_type, d.page_type, d.deleted_at, u.display_name AS deleted_by,
             p.title AS location, s.id AS space_id, s.name AS space_name,
             (WITH RECURSIVE sub AS (
                SELECT c.id, c.deleted_at FROM ${documents} c WHERE c.parent_id = d.id AND c.deleted_at = d.deleted_at
                UNION ALL SELECT c.id, c.deleted_at FROM ${documents} c JOIN sub ON c.parent_id = sub.id WHERE c.deleted_at = sub.deleted_at
              ) SELECT count(*)::int FROM sub) AS inside
      FROM ${documents} d
      JOIN ${spaces} s ON s.id = d.space_id
      LEFT JOIN ${documents} p ON p.id = d.parent_id
      LEFT JOIN ${users} u ON u.id = d.deleted_by_id
      WHERE d.deleted_at IS NOT NULL
        ${spaceIds ? sql`AND d.space_id IN ${spaceIds}` : sql``}
        AND (p.id IS NULL OR p.deleted_at IS NULL OR p.deleted_at <> d.deleted_at)
      ORDER BY d.deleted_at DESC
      LIMIT 500`);
    const days = trashDays();
    return rows.rows.map((r) => {
      const deletedAt = new Date(r.deleted_at);
      return {
        id: r.id,
        title: r.title,
        kind: r.kind,
        icon: r.icon,
        mimeType: r.mime_type,
        pageType: r.page_type,
        deletedAt: deletedAt.toISOString(),
        deletedBy: r.deleted_by,
        inside: r.inside,
        location: r.location,
        purgeAt: new Date(deletedAt.getTime() + days * 86_400_000).toISOString(),
        spaceId: r.space_id,
        spaceName: r.space_name,
      };
    });
  }

  private async deleted(id: string) {
    const [doc] = await this.db
      .select({ id: documents.id, spaceId: documents.spaceId, parentId: documents.parentId, title: documents.title, kind: documents.kind, deletedAt: documents.deletedAt })
      .from(documents)
      .where(eq(documents.id, id));
    if (!doc?.deletedAt) throw new NotFoundException('That item is not in the trash.');
    return doc;
  }

  /** Put it back where it was (or at the space root when its folder is gone), with everything deleted with it. */
  @Post('documents/:id/restore')
  async restore(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const doc = await this.deleted(id);
    await this.perms.assertSpace(user, doc.spaceId, 'edit');
    const ids = await this.trash.subtree(id);
    let parentId = doc.parentId;
    if (parentId) {
      const [parent] = await this.db.select({ deletedAt: documents.deletedAt }).from(documents).where(eq(documents.id, parentId));
      if (!parent || parent.deletedAt) parentId = null;
    }
    await this.db.update(documents).set({ deletedAt: null, deletedById: null }).where(inArray(documents.id, ids));
    if (parentId !== doc.parentId) await this.db.update(documents).set({ parentId }).where(eq(documents.id, id));
    this.activity.record({
      action: 'item.restored',
      actorId: user.id,
      spaceId: doc.spaceId,
      target: { type: doc.kind, id, name: doc.title },
      details: { itemsRestored: ids.length, ...(parentId !== doc.parentId ? { location: 'Space root (its folder was deleted)' } : {}) },
    });
    return { ok: true, parentId, restored: ids.length };
  }

  /** Delete for good, right away. Needs full access to the space. */
  @Delete('documents/:id/permanent')
  async purge(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const doc = await this.deleted(id);
    await this.perms.assertSpace(user, doc.spaceId, 'manage');
    const ids = await this.trash.subtree(id);
    await this.trash.purge(ids);
    this.activity.record({
      action: 'item.purged',
      actorId: user.id,
      spaceId: doc.spaceId,
      target: { type: doc.kind, id, name: doc.title },
      details: { itemsDeleted: ids.length },
    });
    return { ok: true };
  }
}
