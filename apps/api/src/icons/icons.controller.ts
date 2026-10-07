import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { IconCatalogEntry, IconInfo } from '@trigon/shared';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { desc, eq, inArray } from 'drizzle-orm';
import type { Response } from 'express';
import { CurrentUser, type AuthUser } from '../common/decorators';
import { Database, InjectDb } from '../db/db.module';
import { icons } from '../db/schema';
import { StorageService } from '../files/storage.service';
import { ICON_CATALOG } from './catalog';
import { IconsService } from './icons.service';

class FetchIconDto {
  @IsString()
  @MaxLength(255)
  domain: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;
}

@Controller('icons')
export class IconsController {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly icons: IconsService,
    private readonly storage: StorageService,
  ) {}

  /** Curated vendor list, with ids for icons already stored. */
  @Get('catalog')
  async catalog(): Promise<IconCatalogEntry[]> {
    const stored = await this.db
      .select({ id: icons.id, domain: icons.domain })
      .from(icons)
      .where(inArray(icons.domain, ICON_CATALOG.map((c) => c.domain)));
    const byDomain = new Map(stored.map((s) => [s.domain, s.id]));
    return ICON_CATALOG.map((c) => ({ ...c, iconId: byDomain.get(c.domain) ?? null }));
  }

  /** Fetch every catalog icon not yet stored (runs in the background; the picker polls the catalog). */
  @Post('catalog/warm')
  async warm(@CurrentUser() user: AuthUser) {
    const catalog = await this.catalog();
    const missing = catalog.filter((c) => !c.iconId);
    void (async () => {
      for (let i = 0; i < missing.length; i += 6) {
        await Promise.allSettled(missing.slice(i, i + 6).map((c) => this.icons.fetchForDomain(c.domain, c.name, user.id)));
      }
    })();
    return { fetching: missing.length };
  }

  /** Icons people added themselves (custom domains and uploads), newest first. */
  @Get()
  async list(): Promise<IconInfo[]> {
    const catalogDomains = new Set(ICON_CATALOG.map((c) => c.domain));
    const rows = await this.db.select({ id: icons.id, name: icons.name, domain: icons.domain }).from(icons).orderBy(desc(icons.createdAt)).limit(200);
    return rows.filter((r) => !r.domain || !catalogDomains.has(r.domain));
  }

  @Post('fetch')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async fetch(@CurrentUser() user: AuthUser, @Body() dto: FetchIconDto) {
    return { id: await this.icons.fetchForDomain(dto.domain, dto.name, user.id) };
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 1024 * 1024 } }))
  async upload(@CurrentUser() user: AuthUser, @Body('name') name: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('file is required');
    const label = name || file.originalname.replace(/\.[^.]+$/, '');
    return { id: await this.icons.upload(label, file.buffer, file.mimetype, user.id) };
  }

  @Get(':id')
  async serve(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const [row] = await this.db.select().from(icons).where(eq(icons.id, id));
    if (!row) throw new NotFoundException();
    res.set({
      'Content-Type': row.mimeType,
      'Cache-Control': 'private, max-age=604800, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    });
    return new StreamableFile(this.storage.stream(row.storageKey));
  }
}
