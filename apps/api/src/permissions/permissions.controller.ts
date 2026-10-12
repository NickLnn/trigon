import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { PERMISSION_LEVELS, type EffectiveGrant, type PermissionLevel } from '@trigon/shared';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { ActivityService } from '../activity/activity.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CurrentUser, type AuthUser } from '../common/decorators';
import { Database, InjectDb } from '../db/db.module';
import { documents, groups, permissions, spaces, users } from '../db/schema';
import { PermissionsService } from './permissions.service';

class GrantDto {
  @IsIn(['space', 'document'])
  resourceType: 'space' | 'document';

  @IsUUID()
  resourceId: string;

  @IsIn(['user', 'group', 'everyone'])
  subjectType: 'user' | 'group' | 'everyone';

  @IsOptional()
  @IsUUID()
  subjectId?: string;

  @IsIn(PERMISSION_LEVELS as unknown as string[])
  level: PermissionLevel;
}

/** Sharing. Managing grants on a resource requires 'manage' on it. */
@Controller('permissions')
export class PermissionsController {
  constructor(
    private readonly perms: PermissionsService,
    @InjectDb() private readonly db: Database,
    private readonly activity: ActivityService,
    private readonly notifications: NotificationsService,
  ) {}

  /** The shared space or page/folder/file, as an activity target. */
  private async resource(type: 'space' | 'document', id: string) {
    if (type === 'space') {
      const [s] = await this.db.select({ name: spaces.name }).from(spaces).where(eq(spaces.id, id));
      return { spaceId: id, target: { type: 'space', id, name: s?.name ?? 'Space' } };
    }
    const [d] = await this.db.select({ spaceId: documents.spaceId, title: documents.title, kind: documents.kind }).from(documents).where(eq(documents.id, id));
    return { spaceId: d?.spaceId ?? null, target: { type: d?.kind ?? 'item', id, name: d?.title ?? 'Unknown' } };
  }

  private async recordShare(
    actorId: string,
    action: 'share.added' | 'share.changed' | 'share.removed',
    grant: { resourceType: 'space' | 'document'; resourceId: string; subjectType: 'user' | 'group' | 'everyone'; subjectId: string | null; level: PermissionLevel },
    previousLevel?: PermissionLevel,
  ) {
    const [{ spaceId, target }, sharedWith] = await Promise.all([
      this.resource(grant.resourceType, grant.resourceId),
      this.activity.subjectName(grant.subjectType, grant.subjectId),
    ]);
    this.activity.record({
      action,
      actorId,
      spaceId,
      target,
      details: {
        sharedWith,
        sharedWithType: grant.subjectType,
        sharedWithId: grant.subjectId,
        level: grant.level,
        ...(previousLevel ? { previousLevel } : {}),
      },
    });
  }

  private assertManage(user: AuthUser, type: 'space' | 'document', id: string) {
    return type === 'space' ? this.perms.assertSpace(user, id, 'manage') : this.perms.assertDocument(user, id, 'manage');
  }

  /**
   * Everything that grants access to a space or document: its own grants plus those inherited from
   * parent folders and the space, with readable subject and resource names (for the share dialog).
   */
  @Get('effective/:type/:id')
  async effective(@CurrentUser() user: AuthUser, @Param('type') type: string, @Param('id', ParseUUIDPipe) id: string): Promise<EffectiveGrant[]> {
    if (type !== 'space' && type !== 'document') throw new BadRequestException();
    await this.assertManage(user, type, id);

    let spaceId = id;
    let docIds: string[] = [];
    if (type === 'document') {
      const lineage = await this.perms.lineage(id);
      spaceId = lineage.spaceId;
      docIds = lineage.ids; // nearest first
    }

    const rows = await this.db
      .select()
      .from(permissions)
      .where(
        or(
          and(eq(permissions.resourceType, 'space'), eq(permissions.resourceId, spaceId)),
          docIds.length ? and(eq(permissions.resourceType, 'document'), inArray(permissions.resourceId, docIds)) : undefined,
        ),
      );

    const userIds = rows.filter((r) => r.subjectType === 'user' && r.subjectId).map((r) => r.subjectId!);
    const groupIds = rows.filter((r) => r.subjectType === 'group' && r.subjectId).map((r) => r.subjectId!);
    const [userRows, groupRows, docRows, [space]] = await Promise.all([
      userIds.length ? this.db.select({ id: users.id, name: users.displayName, email: users.email }).from(users).where(inArray(users.id, userIds)) : [],
      groupIds.length ? this.db.select({ id: groups.id, name: groups.name, source: groups.source }).from(groups).where(inArray(groups.id, groupIds)) : [],
      docIds.length ? this.db.select({ id: documents.id, title: documents.title }).from(documents).where(inArray(documents.id, docIds)) : [],
      this.db.select({ name: spaces.name }).from(spaces).where(eq(spaces.id, spaceId)),
    ]);
    const userMap = new Map(userRows.map((u) => [u.id, u]));
    const groupMap = new Map(groupRows.map((g) => [g.id, g]));
    const docMap = new Map(docRows.map((d) => [d.id, d.title]));
    const sourceLabel = { local: 'Trigon group', entra: 'Microsoft group', ldap: 'LDAP group' } as const;

    const order = (r: (typeof rows)[number]) => (r.resourceType === 'document' ? docIds.indexOf(r.resourceId) : docIds.length);
    return rows
      .sort((a, b) => order(a) - order(b))
      .map((r) => {
        const u = r.subjectId ? userMap.get(r.subjectId) : undefined;
        const g = r.subjectId ? groupMap.get(r.subjectId) : undefined;
        return {
          id: r.id,
          subjectType: r.subjectType,
          subjectId: r.subjectId,
          subjectName: r.subjectType === 'everyone' ? 'Everyone in Trigon' : (u?.name ?? g?.name ?? 'Unknown'),
          subjectDetail: u?.email ?? (g ? sourceLabel[g.source] : null),
          level: r.level,
          resourceType: r.resourceType,
          resourceId: r.resourceId,
          resourceName: r.resourceType === 'space' ? (space?.name ?? 'Space') : (docMap.get(r.resourceId) ?? 'Folder'),
          inherited: r.resourceId !== id,
        };
      });
  }

  @Get(':type/:id')
  async list(@CurrentUser() user: AuthUser, @Param('type') type: string, @Param('id', ParseUUIDPipe) id: string) {
    if (type !== 'space' && type !== 'document') throw new BadRequestException();
    await this.assertManage(user, type, id);
    return this.perms.list(type, id);
  }

  @Post()
  async grant(@CurrentUser() user: AuthUser, @Body() dto: GrantDto) {
    if (dto.subjectType !== 'everyone' && !dto.subjectId) throw new BadRequestException('subjectId required');
    await this.assertManage(user, dto.resourceType, dto.resourceId);
    const subjectId = dto.subjectType === 'everyone' ? null : (dto.subjectId ?? null);
    const [existing] = await this.db
      .select({ level: permissions.level })
      .from(permissions)
      .where(
        and(
          eq(permissions.resourceType, dto.resourceType),
          eq(permissions.resourceId, dto.resourceId),
          eq(permissions.subjectType, dto.subjectType),
          subjectId ? eq(permissions.subjectId, subjectId) : isNull(permissions.subjectId),
        ),
      );
    const row = await this.perms.grant({ ...dto, subjectId, grantedById: user.id });
    if (!existing) await this.recordShare(user.id, 'share.added', { ...dto, subjectId });
    else if (existing.level !== dto.level) await this.recordShare(user.id, 'share.changed', { ...dto, subjectId }, existing.level);
    if (!existing || existing.level !== dto.level) {
      this.notifications.shared({ actorId: user.id, ...dto, subjectId, previousLevel: existing?.level ?? null });
    }
    return row;
  }

  @Delete(':id')
  async revoke(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const [row] = await this.db.select().from(permissions).where(eq(permissions.id, id)).limit(1);
    if (!row) throw new NotFoundException();
    await this.assertManage(user, row.resourceType, row.resourceId);
    await this.perms.revoke(id);
    await this.recordShare(user.id, 'share.removed', row);
    return { ok: true };
  }
}
