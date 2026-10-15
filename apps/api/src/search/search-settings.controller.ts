import { BadRequestException, Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import type { SearchIndexStatus, SearchSettings } from '@trigon/shared';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsString, Matches, Max, Min } from 'class-validator';
import { and, count, eq, isNull, sql } from 'drizzle-orm';
import { ActivityService } from '../activity/activity.service';
import { CurrentUser, Roles, type AuthUser } from '../common/decorators';
import { Database, InjectDb } from '../db/db.module';
import { documents } from '../db/schema';
import { SettingsService } from '../settings/settings.service';
import { TextIndexService } from './text-index.service';
import { languages, toolsAvailable } from './tools';

class SearchSettingsDto {
  @IsBoolean() ocrEnabled: boolean;
  @IsArray() @ArrayMaxSize(6) @IsString({ each: true }) @Matches(/^[a-z_]{2,20}$/i, { each: true }) ocrLanguages: string[];
  @IsInt() @Min(1) @Max(1000) ocrMaxPages: number;
}

class ReindexDto {
  @IsIn(['all', 'scans']) scope: 'all' | 'scans';
}

/** Settings → Search: OCR languages and the state of the file text index. */
@Controller('settings/search')
@Roles('admin')
export class SearchSettingsController {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly index: TextIndexService,
    private readonly activity: ActivityService,
  ) {}

  @Get()
  async status(): Promise<SearchIndexStatus> {
    const rows = await this.db
      .select({ source: sql<string | null>`case when ${documents.textIndexedAt} is null then 'pending' else ${documents.textSource} end`, n: count() })
      .from(documents)
      .where(and(eq(documents.kind, 'file'), isNull(documents.deletedAt)))
      .groupBy(sql`1`);
    const counts = { pending: 0, text: 0, ocr: 0, empty: 0, unsupported: 0, failed: 0 };
    for (const r of rows) if (r.source && r.source in counts) counts[r.source as keyof typeof counts] = r.n;
    return {
      settings: await this.settings.get('search'),
      ocrAvailable: (await toolsAvailable()).ocr,
      languages: await languages(),
      counts,
      current: this.index.current,
    };
  }

  @Put()
  async save(@CurrentUser() user: AuthUser, @Body() dto: SearchSettingsDto) {
    const installed = new Set((await languages()).map((l) => l.code));
    const missing = dto.ocrLanguages.filter((l) => !installed.has(l));
    if (missing.length && (await toolsAvailable()).ocr) throw new BadRequestException(`Not installed: ${missing.join(', ')}. Add the .traineddata file to data/tessdata first.`);
    if (dto.ocrEnabled && !dto.ocrLanguages.length) throw new BadRequestException('Pick at least one OCR language.');
    const saved = await this.settings.update('search', dto as SearchSettings, user.id);
    this.activity.record({ action: 'settings.updated', actorId: user.id, target: { type: 'settings', id: null, name: 'Search' }, details: { fields: Object.keys(dto) } });
    return saved;
  }

  /** Read files again (all, or only PDFs and images) — e.g. after turning OCR on or adding a language. */
  @Post('reindex')
  @HttpCode(200)
  async reindex(@Body() dto: ReindexDto) {
    return { queued: await this.index.reindex(dto.scope) };
  }
}
