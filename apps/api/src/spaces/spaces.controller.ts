import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { SPACE_SORTS, treeComparator, type DocumentNode, type SpaceSort, type SpaceStats, type SpaceSummary } from '@trigon/shared';
import { IsHexColor, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { ActivityService } from '../activity/activity.service';
import { CurrentUser, Roles, type AuthUser } from '../common/decorators';
import { Database, InjectDb } from '../db/db.module';
import { documents, spaces } from '../db/schema';
import { displayStatus } from '../documents/documents.controller';
import { PermissionsService } from '../permissions/permissions.service';

class CreateSpaceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  icon?: string;

  @IsOptional()
  @IsHexColor()
  color?: string;
}

class UpdateSpaceDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  icon?: string;

  @IsOptional()
  @IsHexColor()
  color?: string;

  @IsOptional()
  @IsIn(SPACE_SORTS)
  sortMode?: SpaceSort;
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .slice(0, 60) || 'space';

export function buildTree(rows: DocumentNode[], mode: SpaceSort = 'alpha'): DocumentNode[] {
  const byId = new Map(rows.map((r) => [r.id, { ...r, children: [] as DocumentNode[] }]));
  const roots: DocumentNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    (parent ? parent.children! : roots).push(node);
  }
  const compare = treeComparator(mode);
  const sort = (list: DocumentNode[]) => {
    list.sort(compare);
    list.forEach((n) => n.children && sort(n.children));
  };
  sort(roots);
  return roots;
}

@Controller('spaces')
export class SpacesController {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly perms: PermissionsService,
    private readonly activity: ActivityService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthUser): Promise<SpaceSummary[]> {
    const levels = await this.perms.spaceLevels(user);
    const rows =
      user.role === 'admin'
        ? await this.db.select().from(spaces).orderBy(asc(spaces.name))
        : levels.size
          ? await this.db.select().from(spaces).where(inArray(spaces.id, [...levels.keys()])).orderBy(asc(spaces.name))
          : [];
    return rows.map((s) => ({
      id: s.id,
      name: s.name,
      slug: s.slug,
      icon: s.icon,
      color: s.color,
      description: s.description,
      sortMode: s.sortMode,
      myPermission: user.role === 'admin' ? 'manage' : levels.get(s.id)!,
    }));
  }

  @Post()
  @Roles('admin', 'editor')
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateSpaceDto) {
    const base = slugify(dto.name);
    const existing = await this.db.select({ slug: spaces.slug }).from(spaces).where(eq(spaces.slug, base));
    const slug = existing.length ? `${base}-${Math.random().toString(36).slice(2, 7)}` : base;
    const [space] = await this.db
      .insert(spaces)
      .values({ ...dto, slug, createdById: user.id })
      .returning();
    await this.perms.grant({
      resourceType: 'space',
      resourceId: space.id,
      subjectType: 'user',
      subjectId: user.id,
      level: 'manage',
      grantedById: user.id,
    });
    this.activity.record({ action: 'space.created', actorId: user.id, spaceId: space.id, target: { type: 'space', id: space.id, name: space.name } });
    return space;
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const myPermission = await this.perms.assertSpace(user, id, 'view');
    const [space] = await this.db.select().from(spaces).where(eq(spaces.id, id));
    return { ...space, myPermission };
  }

  @Patch(':id')
  async update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSpaceDto) {
    await this.perms.assertSpace(user, id, 'manage');
    const [before] = await this.db.select().from(spaces).where(eq(spaces.id, id));
    const [space] = await this.db.update(spaces).set(dto).where(eq(spaces.id, id)).returning();
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const f of ['name', 'description', 'icon', 'color', 'sortMode'] as const) {
      if (dto[f] !== undefined && dto[f] !== before?.[f]) changes[f] = { from: before?.[f] ?? null, to: dto[f] };
    }
    if (Object.keys(changes).length) {
      this.activity.record({ action: 'space.updated', actorId: user.id, spaceId: id, target: { type: 'space', id, name: space.name }, details: { changes } });
    }
    return space;
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.perms.assertSpace(user, id, 'manage');
    const [space] = await this.db.select({ name: spaces.name }).from(spaces).where(eq(spaces.id, id));
    const [{ items }] = await this.db
      .select({ items: sql<number>`count(*)::int` })
      .from(documents)
      .where(and(eq(documents.spaceId, id), isNull(documents.deletedAt)));
    await this.db.delete(spaces).where(eq(spaces.id, id));
    this.activity.record({
      action: 'space.deleted',
      actorId: user.id,
      spaceId: id,
      target: { type: 'space', id, name: space?.name ?? 'Space' },
      details: { itemsDeleted: items },
    });
    return { ok: true };
  }

  /** Header numbers for a space: documents, verified, stale. */
  @Get(':id/stats')
  async stats(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<SpaceStats> {
    await this.perms.assertSpace(user, id, 'view');
    const [row] = await this.db
      .select({
        docs: sql<number>`count(*) filter (where ${documents.kind} <> 'folder')::int`,
        verified: sql<number>`count(*) filter (where ${displayStatus} = 'verified')::int`,
        stale: sql<number>`count(*) filter (where ${displayStatus} = 'stale')::int`,
      })
      .from(documents)
      .where(and(eq(documents.spaceId, id), isNull(documents.deletedAt)));
    return row;
  }

  /** The full navigation tree (folders, pages, files) of a space. */
  @Get(':id/tree')
  async tree(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<DocumentNode[]> {
    await this.perms.assertSpace(user, id, 'view');
    const [space] = await this.db.select({ sortMode: spaces.sortMode }).from(spaces).where(eq(spaces.id, id));
    const rows = await this.db
      .select({
        id: documents.id,
        spaceId: documents.spaceId,
        parentId: documents.parentId,
        kind: documents.kind,
        title: documents.title,
        icon: documents.icon,
        position: documents.position,
        mimeType: documents.mimeType,
        pageType: documents.pageType,
        status: displayStatus,
        updatedAt: documents.updatedAt,
      })
      .from(documents)
      .where(and(eq(documents.spaceId, id), isNull(documents.deletedAt)));
    return buildTree(rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() })), space?.sortMode);
  }
}
