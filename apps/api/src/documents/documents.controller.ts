import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { IsIn, IsNumber, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import { and, desc, eq, isNull, max, sql } from 'drizzle-orm';
import { CurrentUser, type AuthUser } from '../common/decorators';
import { Database, InjectDb } from '../db/db.module';
import { documents, spaces } from '../db/schema';
import { PermissionsService } from '../permissions/permissions.service';

class CreateDocumentDto {
  @IsUUID()
  spaceId: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsIn(['folder', 'page'])
  kind: 'folder' | 'page';

  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  icon?: string;
}

class ImportDocumentDto {
  @IsUUID()
  spaceId: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsString()
  @MaxLength(255)
  title: string;

  /** Sanitised HTML produced client-side from the uploaded .md / .html file. */
  @IsString()
  @MaxLength(5_000_000)
  html: string;
}

/** Rough HTML → plain text, only used to make imported pages searchable before first open. */
function htmlToText(html: string) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|h[1-6]|li|pre|blockquote|tr|div)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

class UpdateDocumentDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  icon?: string;

  /** Move: null puts the document at the space root. */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  parentId?: string | null;

  @IsOptional()
  @IsNumber()
  position?: number;
}

@Controller('documents')
export class DocumentsController {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly perms: PermissionsService,
  ) {}

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateDocumentDto) {
    if (dto.parentId) {
      const { spaceId } = await this.perms.assertDocument(user, dto.parentId, 'edit');
      if (spaceId !== dto.spaceId) throw new BadRequestException('Parent belongs to another space');
    } else {
      await this.perms.assertSpace(user, dto.spaceId, 'edit');
    }
    const [{ last }] = await this.db
      .select({ last: max(documents.position) })
      .from(documents)
      .where(
        and(
          eq(documents.spaceId, dto.spaceId),
          dto.parentId ? eq(documents.parentId, dto.parentId) : isNull(documents.parentId),
        ),
      );
    const [doc] = await this.db
      .insert(documents)
      .values({
        spaceId: dto.spaceId,
        parentId: dto.parentId ?? null,
        kind: dto.kind,
        title: dto.title?.trim() || (dto.kind === 'folder' ? 'New folder' : 'Untitled'),
        icon: dto.icon,
        position: (last ?? 0) + 1,
        createdById: user.id,
        updatedById: user.id,
      })
      .returning({ id: documents.id, title: documents.title, kind: documents.kind });
    return doc;
  }

  /**
   * Create a page from imported Markdown/HTML. The HTML is parked on the row and turned into the
   * collaborative document by the first editor that opens it; search works immediately.
   */
  @Post('import')
  async import(@CurrentUser() user: AuthUser, @Body() dto: ImportDocumentDto) {
    if (dto.parentId) {
      const { spaceId } = await this.perms.assertDocument(user, dto.parentId, 'edit');
      if (spaceId !== dto.spaceId) throw new BadRequestException('Parent belongs to another space');
    } else {
      await this.perms.assertSpace(user, dto.spaceId, 'edit');
    }
    const [{ last }] = await this.db
      .select({ last: max(documents.position) })
      .from(documents)
      .where(and(eq(documents.spaceId, dto.spaceId), dto.parentId ? eq(documents.parentId, dto.parentId) : isNull(documents.parentId)));
    const [doc] = await this.db
      .insert(documents)
      .values({
        spaceId: dto.spaceId,
        parentId: dto.parentId ?? null,
        kind: 'page',
        title: dto.title.trim() || 'Imported page',
        importHtml: dto.html,
        textContent: htmlToText(dto.html).slice(0, 1_000_000),
        position: (last ?? 0) + 1,
        createdById: user.id,
        updatedById: user.id,
      })
      .returning({ id: documents.id, title: documents.title });
    return doc;
  }

  /** Search across everything the user can see (Postgres full-text over title + body text). */
  @Get('search')
  async search(@CurrentUser() user: AuthUser, @Query('q') q = '') {
    const term = q.trim();
    if (term.length < 2) return [];
    const levels = await this.perms.spaceLevels(user);
    const spaceIds = user.role === 'admin' ? null : [...levels.keys()];
    if (spaceIds && !spaceIds.length) return [];

    const tsv = sql`to_tsvector('simple', coalesce(${documents.title}, '') || ' ' || coalesce(${documents.textContent}, ''))`;
    const query = sql`websearch_to_tsquery('simple', ${term})`;
    const rows = await this.db
      .select({
        id: documents.id,
        title: documents.title,
        kind: documents.kind,
        icon: documents.icon,
        spaceId: documents.spaceId,
        spaceName: spaces.name,
        updatedAt: documents.updatedAt,
        snippet: sql<string>`ts_headline('simple', coalesce(${documents.textContent}, ''), ${query}, 'MaxFragments=1,MaxWords=24,MinWords=8,StartSel=<mark>,StopSel=</mark>')`,
        rank: sql<number>`ts_rank(${tsv}, ${query})`,
      })
      .from(documents)
      .innerJoin(spaces, eq(spaces.id, documents.spaceId))
      .where(
        and(
          isNull(documents.deletedAt),
          sql`(${tsv} @@ ${query} OR ${documents.title} ILIKE ${'%' + term + '%'})`,
          spaceIds ? sql`${documents.spaceId} = ANY(${spaceIds}::uuid[])` : undefined,
        ),
      )
      .orderBy(desc(sql`rank`), desc(documents.updatedAt))
      .limit(30);
    return rows;
  }

  /** Recently updated documents for the home screen. */
  @Get('recent')
  async recent(@CurrentUser() user: AuthUser) {
    const levels = await this.perms.spaceLevels(user);
    const spaceIds = user.role === 'admin' ? null : [...levels.keys()];
    if (spaceIds && !spaceIds.length) return [];
    return this.db
      .select({
        id: documents.id,
        title: documents.title,
        kind: documents.kind,
        icon: documents.icon,
        mimeType: documents.mimeType,
        spaceId: documents.spaceId,
        spaceName: spaces.name,
        spaceColor: spaces.color,
        updatedAt: documents.updatedAt,
      })
      .from(documents)
      .innerJoin(spaces, eq(spaces.id, documents.spaceId))
      .where(
        and(
          isNull(documents.deletedAt),
          sql`${documents.kind} <> 'folder'`,
          spaceIds ? sql`${documents.spaceId} = ANY(${spaceIds}::uuid[])` : undefined,
        ),
      )
      .orderBy(desc(documents.updatedAt))
      .limit(20);
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const { level } = await this.perms.assertDocument(user, id, 'view');
    const [doc] = await this.db
      .select({
        id: documents.id,
        spaceId: documents.spaceId,
        parentId: documents.parentId,
        kind: documents.kind,
        title: documents.title,
        icon: documents.icon,
        content: documents.content,
        importHtml: documents.importHtml,
        mimeType: documents.mimeType,
        sizeBytes: documents.sizeBytes,
        createdAt: documents.createdAt,
        updatedAt: documents.updatedAt,
      })
      .from(documents)
      .where(eq(documents.id, id));
    return { ...doc, myPermission: level };
  }

  @Patch(':id')
  async update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDocumentDto) {
    const { spaceId } = await this.perms.assertDocument(user, id, 'edit');
    if (dto.parentId) {
      if (dto.parentId === id) throw new BadRequestException('Cannot move a document into itself');
      const target = await this.perms.assertDocument(user, dto.parentId, 'edit');
      if (target.spaceId !== spaceId) throw new BadRequestException('Cannot move across spaces');
      const cycle = await this.db.execute(sql`
        WITH RECURSIVE up AS (
          SELECT id, parent_id FROM ${documents} WHERE id = ${dto.parentId}
          UNION ALL SELECT d.id, d.parent_id FROM ${documents} d JOIN up ON d.id = up.parent_id
        ) SELECT 1 FROM up WHERE id = ${id} LIMIT 1`);
      if (cycle.rows.length) throw new BadRequestException('Cannot move a folder into its own descendant');
    }
    const [doc] = await this.db
      .update(documents)
      .set({ ...dto, updatedById: user.id })
      .where(eq(documents.id, id))
      .returning({ id: documents.id, title: documents.title, parentId: documents.parentId, position: documents.position });
    return doc;
  }

  /** Soft delete; children disappear with their parent from the tree. */
  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.perms.assertDocument(user, id, 'edit');
    await this.db.execute(sql`
      WITH RECURSIVE sub AS (
        SELECT id FROM ${documents} WHERE id = ${id}
        UNION ALL SELECT d.id FROM ${documents} d JOIN sub ON d.parent_id = sub.id
      )
      UPDATE ${documents} SET deleted_at = now() WHERE id IN (SELECT id FROM sub)`);
    return { ok: true };
  }
}
