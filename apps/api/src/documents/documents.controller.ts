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
  Put,
  Query,
} from '@nestjs/common';
import { DOC_STATUSES, PAGE_TYPES, SEARCH_SINCE_DAYS, type DisplayStatus, type HealthStats, type SearchHit } from '@trigon/shared';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { and, asc, desc, eq, inArray, isNull, max, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { ActivityService } from '../activity/activity.service';
import { CurrentUser, type AuthUser } from '../common/decorators';
import { Database, InjectDb } from '../db/db.module';
import { attachments, documents, spaces, users } from '../db/schema';
import { PermissionsService } from '../permissions/permissions.service';
import { fold, searchWords, snippet } from '../search/fold';

/** Characters of body text fetched around a search match for the excerpt. */
const SNIPPET_CHARS = 360;

class SearchQueryDto {
  @IsOptional() @IsString() @MaxLength(500) q?: string;
  @IsOptional() @IsUUID() space?: string;
  @IsOptional() @IsIn(['page', 'file']) type?: 'page' | 'file';
  @IsOptional() @Type(() => Number) @IsIn(SEARCH_SINCE_DAYS) since?: number;
}

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
  @MaxLength(64)
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

  /** Sanitised HTML produced client-side from the uploaded .md / .html file (or a template). */
  @IsString()
  @MaxLength(5_000_000)
  html: string;

  @IsOptional()
  @IsIn(PAGE_TYPES as unknown as string[])
  pageType?: 'page' | 'runbook' | 'kb';

  @IsOptional()
  @IsIn(['none', 'draft'])
  status?: 'none' | 'draft';

  @IsOptional()
  @IsString()
  @MaxLength(64)
  icon?: string;
}

/** Default review interval when a page doesn't set its own. */
export const DEFAULT_REVIEW_DAYS = 180;

/** Review status as shown to people: "stale" once a verified page is older than its review interval. */
/** reviewIntervalDays: null = default (180), 0 = never needs review. */
export const displayStatus = sql<DisplayStatus>`CASE WHEN ${documents.status} = 'verified' AND coalesce(${documents.reviewIntervalDays}, ${DEFAULT_REVIEW_DAYS}) > 0 AND ${documents.verifiedAt} + make_interval(days => coalesce(${documents.reviewIntervalDays}, ${DEFAULT_REVIEW_DAYS})) < now() THEN 'stale' ELSE ${documents.status}::text END`;

const editor = alias(users, 'editor');

class ImportHtmlDto {
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
  @MaxLength(64)
  icon?: string;

  @IsOptional()
  @IsIn(PAGE_TYPES as unknown as string[])
  pageType?: 'page' | 'runbook' | 'kb';

  /** Use POST /documents/:id/verify to mark verified. */
  @IsOptional()
  @IsIn(DOC_STATUSES.filter((s) => s !== 'verified'))
  status?: 'none' | 'draft';

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(0) // 0 = never
  @Max(3650)
  reviewIntervalDays?: number | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  ownerId?: string | null;

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
    private readonly activity: ActivityService,
  ) {}

  /** Title of a folder/page a document is moved into, or the space root. */
  private async parentName(parentId: string | null) {
    if (!parentId) return 'Space root';
    const [p] = await this.db.select({ title: documents.title }).from(documents).where(eq(documents.id, parentId));
    return p?.title ?? 'Unknown';
  }

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
        ownerId: user.id,
        createdById: user.id,
        updatedById: user.id,
      })
      .returning({ id: documents.id, title: documents.title, kind: documents.kind });
    this.activity.record({
      action: 'item.created',
      actorId: user.id,
      spaceId: dto.spaceId,
      target: { type: doc.kind, id: doc.id, name: doc.title },
      details: { location: await this.parentName(dto.parentId ?? null) },
    });
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
        pageType: dto.pageType ?? 'page',
        status: dto.status ?? 'none',
        icon: dto.icon,
        ownerId: user.id,
        textContent: htmlToText(dto.html).slice(0, 1_000_000),
        position: (last ?? 0) + 1,
        createdById: user.id,
        updatedById: user.id,
      })
      .returning({ id: documents.id, title: documents.title });
    this.activity.record({
      action: 'item.imported',
      actorId: user.id,
      spaceId: dto.spaceId,
      target: { type: 'page', id: doc.id, name: doc.title },
      details: { location: await this.parentName(dto.parentId ?? null) },
    });
    return doc;
  }

  /**
   * Search-as-you-type across everything the user can see: every word is matched as a prefix
   * ("sign ou" finds "Sign out…") over title + body (uploaded files' text included, OCR too) and the
   * OCR'd text of images pasted into pages. Accents and final sigma are ignored ("αθηνα" finds
   * "ΑΘΉΝΑΣ"), title hits rank first, and a per-word trigram fallback catches typos in titles
   * ("postgress" finds "PostgreSQL backups"). Optional filters: space, type (page | file), since (days).
   */
  @Get('search')
  async search(@CurrentUser() user: AuthUser, @Query() dto: SearchQueryDto): Promise<SearchHit[]> {
    const term = fold((dto.q ?? '').trim().slice(0, 200));
    const words = searchWords(term);
    if (!words.length) return [];
    const levels = await this.perms.spaceLevels(user);
    const spaceIds = user.role === 'admin' ? null : [...levels.keys()];
    if (spaceIds && !spaceIds.length) return [];
    if (dto.space && spaceIds && !spaceIds.includes(dto.space)) return [];

    const query = sql`to_tsquery('simple', ${words.map((w) => `${w}:*`).join(' & ')})`;
    const titleHit = sql`(strpos(trigon_fold(${documents.title}), ${term}) > 0)`;
    // Typo tolerance per word: every word must be in the title, or (4+ letters) close to a word in it,
    // so "postgress backup" finds "PostgreSQL backups" but "backup server" doesn't match "Windows Server".
    const typo = words.some((w) => w.length >= 4)
      ? sql`(${sql.join(
          words.map((w) =>
            w.length >= 4
              ? sql`(strpos(trigon_fold(${documents.title}), ${w}) > 0 OR word_similarity(${w}, trigon_fold(${documents.title})) >= 0.5)`
              : sql`(strpos(trigon_fold(${documents.title}), ${w}) > 0)`,
          ),
          sql` AND `,
        )})`
      : sql`false`;
    // The body expression must match documents_search_idx exactly, or the index is not used.
    // Body matches come from the GIN index (subquery); only titles are scanned for the substring / typo checks.
    // Ranking uses the title alone, so no document body is re-read per keystroke; recency breaks ties.
    const bodyHit = sql`${documents.id} IN (SELECT d.id FROM ${documents} d WHERE to_tsvector('simple', trigon_fold(coalesce(d.title, '') || ' ' || coalesce(d.text_content, ''))) @@ ${query})`;
    // Images pasted into pages (attachments_search_idx), counted only while the page still shows them:
    // removed images stay stored for page history, but shouldn't make the page match.
    const imageHit = sql`${documents.id} IN (${this.imageMatches(query)})`;
    const rank = sql<number>`(ts_rank(to_tsvector('simple', trigon_fold(${documents.title})), ${query}) + CASE WHEN ${titleHit} THEN 1 WHEN ${typo} THEN 0.5 ELSE 0 END)`;
    const hits = await this.db
      .select({
        id: documents.id,
        title: documents.title,
        kind: documents.kind,
        icon: documents.icon,
        mimeType: documents.mimeType,
        pageType: documents.pageType,
        status: displayStatus,
        spaceId: documents.spaceId,
        spaceName: spaces.name,
        updatedAt: documents.updatedAt,
        textSource: documents.textSource,
      })
      .from(documents)
      .innerJoin(spaces, eq(spaces.id, documents.spaceId))
      .where(
        and(
          isNull(documents.deletedAt),
          sql`(${bodyHit} OR ${titleHit} OR ${typo} OR ${imageHit})`,
          spaceIds ? inArray(documents.spaceId, spaceIds) : undefined,
          dto.space ? eq(documents.spaceId, dto.space) : undefined,
          dto.type ? eq(documents.kind, dto.type) : undefined,
          dto.since ? sql`${documents.updatedAt} >= now() - make_interval(days => ${dto.since})` : undefined,
        ),
      )
      // Order by the expression itself — a SELECT alias isn't visible here (that was the old bug).
      .orderBy(desc(rank), desc(documents.updatedAt))
      .limit(20);
    if (!hits.length) return [];

    // Excerpts: a window of the original text around the first matched word (found in the folded text,
    // which keeps character positions), highlighted in JS so accented words get marked too. For PDFs the
    // form feeds before the match give its page number.
    const ids = sql.join(hits.map((h) => sql`${h.id}`), sql`, `);
    const first = sql.join(words.map((w) => sql`nullif(strpos(b, ${w}), 0)`), sql`, `);
    const windows = await this.db.execute<{ id: string; win: string | null; s: number; pos: number | null; page: number | null }>(sql`
      select id, substr(text_content, s, ${SNIPPET_CHARS + 1}) as win, s, pos,
             case when pos is null then null
                  else char_length(left(text_content, pos)) - char_length(replace(left(text_content, pos), chr(12), '')) + 1 end as page
      from (
        select id, text_content, pos, greatest(coalesce(pos, 1) - 100, 1) as s
        from (select id, text_content, least(${first}) as pos
              from (select id, text_content, trigon_fold(left(text_content, 100000)) as b from ${documents} where id in (${ids})) x) y
      ) z`);
    const byId = new Map(windows.rows.map((r) => [r.id, r]));

    // Pages whose words weren't in the body but in one of their images: excerpt from the image text.
    const imageOnly = hits.filter((h) => h.kind === 'page' && byId.get(h.id)?.pos == null).map((h) => h.id);
    const imageWindows = new Map<string, { win: string; s: number }>();
    if (imageOnly.length) {
      const rows = await this.db.execute<{ id: string; win: string; s: number }>(sql`
        select distinct on (document_id) document_id as id, substr(text_content, s, ${SNIPPET_CHARS + 1}) as win, s
        from (
          select a.document_id, a.text_content, a.created_at,
                 greatest(coalesce(least(${first}), 1) - 100, 1) as s
          from (select a.*, trigon_fold(left(a.text_content, 100000)) as b from ${attachments} a
                where a.id in (${this.imageMatches(query, sql`and ia.document_id in (${sql.join(imageOnly.map((id) => sql`${id}`), sql`, `)})`, true)})) a
        ) w
        order by document_id, created_at`);
      for (const r of rows.rows) imageWindows.set(r.id, r);
    }

    return hits.map(({ textSource, ...h }) => {
      const body = byId.get(h.id);
      const image = imageWindows.get(h.id);
      const isPdf = h.mimeType === 'application/pdf' || /\.pdf$/i.test(h.title);
      let foundIn: SearchHit['foundIn'] = null;
      let excerpt = '';
      if (body?.pos != null && body.win) {
        foundIn = textSource === 'ocr' ? 'scan' : 'text';
        excerpt = snippet(body.win, words, body.s > 1, Array.from(body.win).length > SNIPPET_CHARS);
      } else if (image) {
        foundIn = 'image';
        excerpt = snippet(image.win, words, image.s > 1, Array.from(image.win).length > SNIPPET_CHARS);
      } else if (body?.win) {
        // Matched on the title only: show the start of the text.
        excerpt = snippet(body.win, words, false, Array.from(body.win).length > SNIPPET_CHARS);
      }
      return {
        ...h,
        updatedAt: h.updatedAt.toISOString(),
        snippet: excerpt,
        foundIn,
        page: isPdf && body?.pos != null ? Number(body.page) : null,
      };
    });
  }

  /**
   * Page images whose OCR text matches `query` and that the page still shows (its content, or a
   * not-yet-opened import, links /api/files/attachments/<id>). Selects document_id, or the
   * attachment id with `attachmentIds`.
   */
  private imageMatches(query: SQL, extra: SQL = sql``, attachmentIds = false) {
    return sql`SELECT ${attachmentIds ? sql`ia.id` : sql`ia.document_id`} FROM ${attachments} ia JOIN ${documents} idoc ON idoc.id = ia.document_id
      WHERE to_tsvector('simple', trigon_fold(coalesce(ia.text_content, ''))) @@ ${query}
        AND strpos(coalesce(idoc.content::text, idoc.import_html, ''), ia.id::text) > 0 ${extra}`;
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
        spaceIcon: spaces.icon,
        pageType: documents.pageType,
        status: displayStatus,
        updatedAt: documents.updatedAt,
        updatedByName: editor.displayName,
      })
      .from(documents)
      .innerJoin(spaces, eq(spaces.id, documents.spaceId))
      .leftJoin(editor, eq(editor.id, documents.updatedById))
      .where(
        and(
          isNull(documents.deletedAt),
          sql`${documents.kind} <> 'folder'`,
          spaceIds ? inArray(documents.spaceId, spaceIds) : undefined,
        ),
      )
      .orderBy(desc(documents.updatedAt))
      .limit(20);
  }

  /** Knowledge-base health for the home screen: how much is verified, and what needs review. */
  @Get('health')
  async health(@CurrentUser() user: AuthUser): Promise<HealthStats> {
    const levels = await this.perms.spaceLevels(user);
    const spaceIds = user.role === 'admin' ? null : [...levels.keys()];
    const empty = { total: 0, verified: 0, stale: 0, drafts: 0, score: 0, needsReview: [] };
    if (spaceIds && !spaceIds.length) return empty;
    const scope = and(
      isNull(documents.deletedAt),
      eq(documents.kind, 'page'),
      spaceIds ? inArray(documents.spaceId, spaceIds) : undefined,
    );
    const [counts] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        verified: sql<number>`count(*) filter (where ${displayStatus} = 'verified')::int`,
        stale: sql<number>`count(*) filter (where ${displayStatus} = 'stale')::int`,
        drafts: sql<number>`count(*) filter (where ${displayStatus} = 'draft')::int`,
      })
      .from(documents)
      .where(scope);
    const needsReview = await this.db
      .select({
        id: documents.id,
        title: documents.title,
        icon: documents.icon,
        spaceId: documents.spaceId,
        spaceName: spaces.name,
        status: displayStatus,
        since: sql<string>`coalesce(${documents.verifiedAt}, ${documents.updatedAt})`,
      })
      .from(documents)
      .innerJoin(spaces, eq(spaces.id, documents.spaceId))
      .where(and(scope, sql`${displayStatus} in ('stale', 'draft')`))
      .orderBy(asc(sql`coalesce(${documents.verifiedAt}, ${documents.updatedAt})`))
      .limit(50);
    return {
      ...counts,
      score: counts.total ? Math.round((counts.verified / counts.total) * 100) : 0,
      needsReview: needsReview.map((n) => ({ ...n, since: new Date(n.since).toISOString() })),
    };
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
        pageType: documents.pageType,
        status: displayStatus,
        verifiedAt: documents.verifiedAt,
        reviewIntervalDays: documents.reviewIntervalDays,
        tags: documents.tags,
        ownerId: documents.ownerId,
        verifiedById: documents.verifiedById,
        updatedById: documents.updatedById,
        createdById: documents.createdById,
        createdAt: documents.createdAt,
        updatedAt: documents.updatedAt,
      })
      .from(documents)
      .where(eq(documents.id, id));
    const peopleIds = [doc.ownerId, doc.verifiedById, doc.updatedById, doc.createdById].filter((v): v is string => !!v);
    const people = peopleIds.length
      ? await this.db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, peopleIds))
      : [];
    const name = (uid: string | null) => people.find((p) => p.id === uid)?.name ?? null;
    return {
      ...doc,
      reviewIntervalDays: doc.reviewIntervalDays ?? DEFAULT_REVIEW_DAYS,
      ownerName: name(doc.ownerId ?? doc.createdById),
      verifiedByName: name(doc.verifiedById),
      updatedByName: name(doc.updatedById),
      createdByName: name(doc.createdById),
      myPermission: level,
    };
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
    const [before] = await this.db.select().from(documents).where(eq(documents.id, id));
    const [doc] = await this.db
      .update(documents)
      .set({ ...dto, updatedById: user.id })
      .where(eq(documents.id, id))
      .returning({ id: documents.id, title: documents.title, parentId: documents.parentId, position: documents.position });
    await this.recordUpdate(user, before, dto);
    return doc;
  }

  /**
   * Replace the pending import HTML of a page that hasn't been opened yet (bulk importer: it creates
   * the page, uploads the page's images, then sets the final HTML with local image URLs).
   */
  @Put(':id/import-html')
  async setImportHtml(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ImportHtmlDto) {
    await this.perms.assertDocument(user, id, 'edit');
    const [row] = await this.db
      .update(documents)
      .set({ importHtml: dto.html, textContent: htmlToText(dto.html).slice(0, 1_000_000), updatedById: user.id })
      .where(and(eq(documents.id, id), isNull(documents.ydoc)))
      .returning({ id: documents.id });
    if (!row) throw new BadRequestException('This page has already been opened and edited');
    return { ok: true };
  }

  /** Mark a page as verified (reviewed and correct) — resets its review clock. */
  @Post(':id/verify')
  async verify(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.perms.assertDocument(user, id, 'edit');
    const [doc] = await this.db
      .update(documents)
      .set({ status: 'verified', verifiedAt: new Date(), verifiedById: user.id })
      .where(eq(documents.id, id))
      .returning({ spaceId: documents.spaceId, title: documents.title, kind: documents.kind });
    this.activity.record({ action: 'page.verified', actorId: user.id, spaceId: doc.spaceId, target: { type: doc.kind, id, name: doc.title } });
    return { ok: true };
  }

  /** Soft delete; children disappear with their parent from the tree. */
  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.perms.assertDocument(user, id, 'edit');
    const [doc] = await this.db
      .select({ spaceId: documents.spaceId, title: documents.title, kind: documents.kind, parentId: documents.parentId })
      .from(documents)
      .where(eq(documents.id, id));
    const result = await this.db.execute(sql`
      WITH RECURSIVE sub AS (
        SELECT id FROM ${documents} WHERE id = ${id}
        UNION ALL SELECT d.id FROM ${documents} d JOIN sub ON d.parent_id = sub.id
      )
      UPDATE ${documents} SET deleted_at = now(), deleted_by_id = ${user.id} WHERE id IN (SELECT id FROM sub) AND deleted_at IS NULL`);
    this.activity.record({
      action: 'item.deleted',
      actorId: user.id,
      spaceId: doc.spaceId,
      target: { type: doc.kind, id, name: doc.title },
      details: { location: await this.parentName(doc.parentId), itemsDeleted: result.rowCount ?? 1 },
    });
    return { ok: true };
  }

  /** Rename, move and property changes become separate, readable activity entries. Reordering alone isn't logged. */
  private async recordUpdate(user: AuthUser, before: typeof documents.$inferSelect, dto: UpdateDocumentDto) {
    const base = { actorId: user.id, spaceId: before.spaceId };
    const target = { type: before.kind, id: before.id, name: dto.title ?? before.title };
    if (dto.title !== undefined && dto.title !== before.title) {
      this.activity.record({ ...base, action: 'item.renamed', target, details: { from: before.title, to: dto.title } });
    }
    if (dto.parentId !== undefined && dto.parentId !== before.parentId) {
      const [from, to] = await Promise.all([this.parentName(before.parentId), this.parentName(dto.parentId)]);
      this.activity.record({ ...base, action: 'item.moved', target, details: { from, to } });
    }
    const person = async (uid: string | null | undefined) => {
      if (!uid) return null;
      const [u] = await this.db.select({ name: users.displayName }).from(users).where(eq(users.id, uid));
      return u?.name ?? 'Unknown';
    };
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const f of ['icon', 'pageType', 'status', 'tags', 'reviewIntervalDays'] as const) {
      if (dto[f] !== undefined && JSON.stringify(dto[f]) !== JSON.stringify(before[f])) changes[f] = { from: before[f], to: dto[f] };
    }
    if (dto.ownerId !== undefined && dto.ownerId !== before.ownerId) {
      changes.owner = { from: await person(before.ownerId), to: await person(dto.ownerId) };
    }
    if (Object.keys(changes).length) this.activity.record({ ...base, action: 'item.updated', target, details: { changes } });
  }
}
