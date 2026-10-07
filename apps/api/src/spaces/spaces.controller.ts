import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import type { DocumentNode, SpaceSummary } from '@trigon/shared';
import { IsHexColor, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { CurrentUser, type AuthUser } from '../common/decorators';
import { Database, InjectDb } from '../db/db.module';
import { documents, spaces } from '../db/schema';
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
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .slice(0, 60) || 'space';

export function buildTree(rows: DocumentNode[]): DocumentNode[] {
  const byId = new Map(rows.map((r) => [r.id, { ...r, children: [] as DocumentNode[] }]));
  const roots: DocumentNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    (parent ? parent.children! : roots).push(node);
  }
  const sort = (list: DocumentNode[]) => {
    list.sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
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
      myPermission: user.role === 'admin' ? 'manage' : levels.get(s.id)!,
    }));
  }

  @Post()
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
    const [space] = await this.db.update(spaces).set(dto).where(eq(spaces.id, id)).returning();
    return space;
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.perms.assertSpace(user, id, 'manage');
    await this.db.delete(spaces).where(eq(spaces.id, id));
    return { ok: true };
  }

  /** The full navigation tree (folders, pages, files) of a space. */
  @Get(':id/tree')
  async tree(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<DocumentNode[]> {
    await this.perms.assertSpace(user, id, 'view');
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
        updatedAt: documents.updatedAt,
      })
      .from(documents)
      .where(and(eq(documents.spaceId, id), isNull(documents.deletedAt)));
    return buildTree(rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() })));
  }
}
