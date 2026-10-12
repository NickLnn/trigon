import { BadRequestException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import type { DocumentVersion, DocumentVersionDetail } from '@trigon/shared';
import { eq, inArray } from 'drizzle-orm';
import { ActivityService } from '../activity/activity.service';
import { textDiff } from '../activity/text-diff';
import { CollabService } from '../collab/collab.service';
import { CurrentUser, type AuthUser } from '../common/decorators';
import { Database, InjectDb } from '../db/db.module';
import { documents, users } from '../db/schema';
import { PermissionsService } from '../permissions/permissions.service';
import { VersionsService } from './versions.service';

const stamp = (d: Date) => d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';

/** Page history: list versions, look at one (with what changed), restore it. */
@Controller('documents/:id/versions')
export class VersionsController {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly versions: VersionsService,
    private readonly collab: CollabService,
    private readonly activity: ActivityService,
    private readonly perms: PermissionsService,
  ) {}

  private async withNames(rows: Awaited<ReturnType<VersionsService['list']>>): Promise<DocumentVersion[]> {
    const ids = [...new Set(rows.map((r) => r.createdById).filter((x): x is string => !!x))];
    const people = ids.length ? await this.db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, ids)) : [];
    const name = new Map(people.map((p) => [p.id, p.name]));
    return rows.map((r, i) => {
      const older = rows[i + 1];
      const d = textDiff(older?.textContent ?? '', r.textContent);
      return {
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        author: r.createdById ? { id: r.createdById, name: name.get(r.createdById) ?? 'Unknown' } : null,
        title: r.title,
        note: r.note,
        added: d.added,
        removed: d.removed,
        current: i === 0,
      };
    });
  }

  @Get()
  async list(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<DocumentVersion[]> {
    await this.perms.assertDocument(user, id, 'view');
    return this.withNames(await this.versions.list(id));
  }

  @Get(':versionId')
  async get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('versionId', ParseUUIDPipe) versionId: string): Promise<DocumentVersionDetail> {
    await this.perms.assertDocument(user, id, 'view');
    const all = await this.versions.list(id);
    const index = all.findIndex((v) => v.id === versionId);
    const version = index >= 0 ? await this.versions.get(id, versionId) : null;
    if (!version) throw new NotFoundException();
    const [summary] = await this.withNames(all.slice(index, index + 2));
    return { ...summary, content: version.content ?? null, diff: textDiff(all[index + 1]?.textContent ?? '', version.textContent) };
  }

  @Post(':versionId/restore')
  async restore(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('versionId', ParseUUIDPipe) versionId: string) {
    const { spaceId } = await this.perms.assertDocument(user, id, 'edit');
    const version = await this.versions.get(id, versionId);
    if (!version) throw new NotFoundException();
    const [doc] = await this.db.select({ title: documents.title, kind: documents.kind }).from(documents).where(eq(documents.id, id));
    if (doc.kind !== 'page') throw new BadRequestException('Only pages have version history.');
    const note = `Restored the version from ${stamp(version.updatedAt)}`;
    await this.collab.restore(id, version.ydoc, user.id, note);
    if (version.title !== doc.title) await this.db.update(documents).set({ title: version.title, updatedById: user.id }).where(eq(documents.id, id));
    this.activity.record({
      action: 'version.restored',
      actorId: user.id,
      spaceId,
      target: { type: 'page', id, name: version.title },
      details: { version: stamp(version.updatedAt), ...(version.title !== doc.title ? { from: doc.title, to: version.title } : {}) },
    });
    return { ok: true };
  }
}
