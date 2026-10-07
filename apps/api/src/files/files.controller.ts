import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsOptional, IsString, IsUUID, IsUrl, MaxLength } from 'class-validator';
import { and, eq, isNull, max } from 'drizzle-orm';
import type { Response } from 'express';
import { isTextFile } from '@trigon/shared';
import { CurrentUser, type AuthUser } from '../common/decorators';
import { safeFetch } from '../common/ssrf';
import { Database, InjectDb } from '../db/db.module';
import { attachments, documents } from '../db/schema';
import { PermissionsService } from '../permissions/permissions.service';
import { StorageService } from './storage.service';

const MAX_BYTES = Number(process.env.MAX_UPLOAD_MB ?? 50) * 1024 * 1024;
const IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp|avif|svg\+xml)$/;

class UploadFileDto {
  @IsUUID()
  spaceId: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;
}

class SaveTextDto {
  @IsString()
  @MaxLength(5_000_000)
  content: string;
}

class ImportImageDto {
  @IsUUID()
  documentId: string;

  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  url: string;
}

@Controller('files')
export class FilesController {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly perms: PermissionsService,
    private readonly storage: StorageService,
  ) {}

  /** Upload a .docx / .pdf / any file as a node in the space tree. */
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  async upload(@CurrentUser() user: AuthUser, @Body() dto: UploadFileDto, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('file is required');
    if (dto.parentId) {
      const { spaceId } = await this.perms.assertDocument(user, dto.parentId, 'edit');
      if (spaceId !== dto.spaceId) throw new BadRequestException('Parent belongs to another space');
    } else {
      await this.perms.assertSpace(user, dto.spaceId, 'edit');
    }
    const storageKey = await this.storage.put(file.buffer);
    const [{ last }] = await this.db
      .select({ last: max(documents.position) })
      .from(documents)
      .where(and(eq(documents.spaceId, dto.spaceId), dto.parentId ? eq(documents.parentId, dto.parentId) : isNull(documents.parentId)));
    const [doc] = await this.db
      .insert(documents)
      .values({
        spaceId: dto.spaceId,
        parentId: dto.parentId ?? null,
        kind: 'file',
        title: Buffer.from(file.originalname, 'latin1').toString('utf8'),
        mimeType: file.mimetype,
        sizeBytes: file.size,
        storageKey,
        position: (last ?? 0) + 1,
        createdById: user.id,
        updatedById: user.id,
      })
      .returning({ id: documents.id, title: documents.title, mimeType: documents.mimeType });
    return doc;
  }

  /** Raw bytes of a file node, streamed inline so the in-app DOCX/PDF viewers can render it. */
  @Get(':documentId/content')
  async content(
    @CurrentUser() user: AuthUser,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.perms.assertDocument(user, documentId, 'view');
    const [doc] = await this.db.select().from(documents).where(eq(documents.id, documentId));
    if (!doc?.storageKey) throw new NotFoundException();
    res.set({
      'Content-Type': doc.mimeType ?? 'application/octet-stream',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(doc.title)}`,
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(this.storage.stream(doc.storageKey));
  }

  /** Save edits to a text/code file node (yaml, json, txt, scripts…). The previous blob is replaced. */
  @Put(':documentId/content')
  async saveText(@CurrentUser() user: AuthUser, @Param('documentId', ParseUUIDPipe) documentId: string, @Body() dto: SaveTextDto) {
    await this.perms.assertDocument(user, documentId, 'edit');
    const [doc] = await this.db.select().from(documents).where(eq(documents.id, documentId));
    if (!doc || doc.kind !== 'file' || !doc.storageKey) throw new NotFoundException();
    if (!isTextFile(doc.title, doc.mimeType)) throw new BadRequestException('Only text and code files can be edited');
    const data = Buffer.from(dto.content, 'utf8');
    const storageKey = await this.storage.put(data);
    await this.db
      .update(documents)
      .set({ storageKey, sizeBytes: data.length, textContent: dto.content.slice(0, 1_000_000), updatedById: user.id })
      .where(eq(documents.id, documentId));
    await this.storage.remove(doc.storageKey);
    return { ok: true, sizeBytes: data.length };
  }

  /** Upload an image pasted into a page. */
  @Post('attachments')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  async uploadAttachment(@CurrentUser() user: AuthUser, @Body('documentId') documentId: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('file is required');
    if (!IMAGE_TYPES.test(file.mimetype)) throw new BadRequestException('Only images can be attached inline');
    await this.perms.assertDocument(user, documentId, 'edit');
    return this.saveAttachment(user, documentId, file.buffer, file.mimetype, file.originalname, null);
  }

  /**
   * Web-clipper support: copy a remote image referenced by pasted HTML into local storage,
   * so clipped pages don't hot-link (and don't break when the source disappears).
   */
  @Post('attachments/import')
  async importImage(@CurrentUser() user: AuthUser, @Body() dto: ImportImageDto) {
    await this.perms.assertDocument(user, dto.documentId, 'edit');
    const { buffer, contentType } = await safeFetch(dto.url, { maxBytes: 15 * 1024 * 1024, accept: 'image/*' });
    const mime = contentType.split(';')[0].trim().toLowerCase();
    if (!IMAGE_TYPES.test(mime)) throw new BadRequestException(`Not an image (${mime})`);
    return this.saveAttachment(user, dto.documentId, buffer, mime, null, dto.url);
  }

  private async saveAttachment(user: AuthUser, documentId: string, data: Buffer, mimeType: string, fileName: string | null, sourceUrl: string | null) {
    const storageKey = await this.storage.put(data);
    const [row] = await this.db
      .insert(attachments)
      .values({ documentId, storageKey, mimeType, fileName, sizeBytes: data.length, sourceUrl, createdById: user.id })
      .returning({ id: attachments.id });
    return { id: row.id, url: `/api/files/attachments/${row.id}` };
  }

  @Get('attachments/:id')
  async attachment(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const [att] = await this.db.select().from(attachments).where(eq(attachments.id, id));
    if (!att) throw new NotFoundException();
    await this.perms.assertDocument(user, att.documentId, 'view');
    res.set({
      'Content-Type': att.mimeType,
      'Cache-Control': 'private, max-age=86400, immutable',
      'X-Content-Type-Options': 'nosniff',
      // SVGs can carry script; sandbox them when opened directly
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    });
    return new StreamableFile(this.storage.stream(att.storageKey));
  }
}
