import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { atLeast, PERMISSION_LEVELS, permissionRank, type PermissionLevel } from '@trigon/shared';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import type { AuthUser } from '../common/decorators';
import { Database, InjectDb } from '../db/db.module';
import { documents, groupMembers, permissions } from '../db/schema';

/**
 * Inherited RBAC.
 *
 * A user's effective level on a document is the strongest grant found on the document itself,
 * on any ancestor folder, or on its space — where a grant may target the user directly, any
 * group they belong to (local, Entra or LDAP-synced), or "everyone". System admins get 'manage'.
 */
@Injectable()
export class PermissionsService {
  constructor(@InjectDb() private readonly db: Database) {}

  private async subjectFilter(userId: string) {
    const memberships = await this.db
      .select({ groupId: groupMembers.groupId })
      .from(groupMembers)
      .where(eq(groupMembers.userId, userId));
    const groupIds = memberships.map((m) => m.groupId);
    return or(
      eq(permissions.subjectType, 'everyone'),
      and(eq(permissions.subjectType, 'user'), eq(permissions.subjectId, userId)),
      groupIds.length ? and(eq(permissions.subjectType, 'group'), inArray(permissions.subjectId, groupIds)) : undefined,
    );
  }

  private strongest(levels: PermissionLevel[]): PermissionLevel | null {
    let best: PermissionLevel | null = null;
    for (const l of levels) if (permissionRank(l) > permissionRank(best)) best = l;
    return best;
  }

  async spaceLevel(user: AuthUser, spaceId: string): Promise<PermissionLevel | null> {
    if (user.role === 'admin') return 'manage';
    const rows = await this.db
      .select({ level: permissions.level })
      .from(permissions)
      .where(and(eq(permissions.resourceType, 'space'), eq(permissions.resourceId, spaceId), await this.subjectFilter(user.id)));
    return this.strongest(rows.map((r) => r.level));
  }

  /** Space ids where the user holds any grant, with the level — used to list spaces. */
  async spaceLevels(user: AuthUser): Promise<Map<string, PermissionLevel>> {
    const rows = await this.db
      .select({ spaceId: permissions.resourceId, level: permissions.level })
      .from(permissions)
      .where(and(eq(permissions.resourceType, 'space'), await this.subjectFilter(user.id)));
    const out = new Map<string, PermissionLevel>();
    for (const r of rows) {
      if (permissionRank(r.level) > permissionRank(out.get(r.spaceId))) out.set(r.spaceId, r.level);
    }
    return out;
  }

  /** Document id + all ancestor ids, nearest first, and the owning space. */
  private async lineage(documentId: string): Promise<{ spaceId: string; ids: string[] }> {
    const result = await this.db.execute<{ id: string; space_id: string }>(sql`
      WITH RECURSIVE chain AS (
        SELECT id, parent_id, space_id, 0 AS depth FROM ${documents} WHERE id = ${documentId} AND deleted_at IS NULL
        UNION ALL
        SELECT d.id, d.parent_id, d.space_id, c.depth + 1 FROM ${documents} d JOIN chain c ON d.id = c.parent_id
      )
      SELECT id, space_id FROM chain ORDER BY depth
    `);
    if (!result.rows.length) throw new NotFoundException('Document not found');
    return { spaceId: result.rows[0].space_id, ids: result.rows.map((r) => r.id) };
  }

  async documentLevel(user: AuthUser, documentId: string): Promise<{ level: PermissionLevel | null; spaceId: string }> {
    const { spaceId, ids } = await this.lineage(documentId);
    if (user.role === 'admin') return { level: 'manage', spaceId };
    const rows = await this.db
      .select({ level: permissions.level })
      .from(permissions)
      .where(
        and(
          or(
            and(eq(permissions.resourceType, 'space'), eq(permissions.resourceId, spaceId)),
            and(eq(permissions.resourceType, 'document'), inArray(permissions.resourceId, ids)),
          ),
          await this.subjectFilter(user.id),
        ),
      );
    return { level: this.strongest(rows.map((r) => r.level)), spaceId };
  }

  async assertSpace(user: AuthUser, spaceId: string, required: PermissionLevel) {
    const level = await this.spaceLevel(user, spaceId);
    if (!atLeast(level, required)) throw new ForbiddenException(`Requires '${required}' on this space`);
    return level!;
  }

  async assertDocument(user: AuthUser, documentId: string, required: PermissionLevel) {
    const { level, spaceId } = await this.documentLevel(user, documentId);
    if (!atLeast(level, required)) throw new ForbiddenException(`Requires '${required}' on this document`);
    return { level: level!, spaceId };
  }

  async grant(input: {
    resourceType: 'space' | 'document';
    resourceId: string;
    subjectType: 'user' | 'group' | 'everyone';
    subjectId: string | null;
    level: PermissionLevel;
    grantedById: string;
  }) {
    if (!PERMISSION_LEVELS.includes(input.level)) throw new ForbiddenException('Unknown level');
    const subjectId = input.subjectType === 'everyone' ? null : input.subjectId;
    const [row] = await this.db
      .insert(permissions)
      .values({ ...input, subjectId })
      .onConflictDoUpdate({
        target: [permissions.resourceType, permissions.resourceId, permissions.subjectType, permissions.subjectId],
        set: { level: input.level, grantedById: input.grantedById },
      })
      .returning();
    return row;
  }

  async revoke(permissionId: string) {
    await this.db.delete(permissions).where(eq(permissions.id, permissionId));
  }

  list(resourceType: 'space' | 'document', resourceId: string) {
    return this.db
      .select()
      .from(permissions)
      .where(and(eq(permissions.resourceType, resourceType), eq(permissions.resourceId, resourceId)));
  }
}
