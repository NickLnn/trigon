import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Logger, Param, Post, Put, Res } from '@nestjs/common';
import type { BackupOverview, BackupSettings } from '@trigon/shared';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { CronJob } from 'cron';
import type { Response } from 'express';
import { createReadStream } from 'node:fs';
import { ActivityService } from '../activity/activity.service';
import { CurrentUser, Roles, type AuthUser } from '../common/decorators';
import { SettingsService } from '../settings/settings.service';
import { BackupService } from './backup.service';

class BackupSettingsDto {
  @IsBoolean() enabled: boolean;
  @IsString() @MaxLength(100) schedule: string;
  @IsInt() @Min(1) @Max(365) keep: number;
  @IsIn(['local', 'smb', 'nfs']) destination: BackupSettings['destination'];
  @IsString() @MaxLength(300) localPath: string;
  @IsString() @MaxLength(255) nfsServer: string;
  @IsString() @MaxLength(500) nfsExport: string;
  @IsString() @MaxLength(255) smbHost: string;
  @IsString() @MaxLength(255) smbShare: string;
  @IsString() @MaxLength(500) smbPath: string;
  @IsString() @MaxLength(255) smbUser: string;
  @IsString() @MaxLength(255) smbDomain: string;
  @IsOptional() @IsString() @MaxLength(500) smbPassword?: string;
}

class RestoreDto {
  /** Typed by the admin to confirm: the backup's file name. */
  @IsString() confirm: string;
}

/** Settings → Backups. Administrators only. */
@Controller('backups')
@Roles('admin')
export class BackupsController {
  private readonly logger = new Logger(BackupsController.name);

  constructor(
    private readonly backups: BackupService,
    private readonly settings: SettingsService,
    private readonly activity: ActivityService,
  ) {}

  @Get()
  overview(): Promise<BackupOverview> {
    return this.backups.overview();
  }

  @Put('settings')
  async save(@CurrentUser() user: AuthUser, @Body() dto: BackupSettingsDto) {
    if (dto.schedule) {
      try {
        CronJob.from({ cronTime: dto.schedule, onTick: () => undefined });
      } catch {
        throw new BadRequestException(`Invalid schedule "${dto.schedule}"`);
      }
    }
    if (dto.destination === 'local' && !dto.localPath.startsWith('/')) throw new BadRequestException('The folder must be an absolute path inside the container, e.g. /data/backups');
    await this.settings.update('backup', dto as Partial<BackupSettings>, user.id);
    this.activity.record({ action: 'settings.updated', actorId: user.id, target: { type: 'settings', id: null, name: 'Backups' }, details: { fields: Object.keys(dto) } });
    return this.backups.overview();
  }

  @Post('test')
  @HttpCode(200)
  test(@Body() dto: BackupSettingsDto) {
    return this.backups.test(dto as BackupSettings);
  }

  @Post('run')
  @HttpCode(202)
  runNow(@CurrentUser() user: AuthUser) {
    return this.backups.start('manual', user.id);
  }

  @Get('files/:name')
  async download(@Param('name') name: string, @Res() res: Response) {
    const { file, cleanup } = await this.backups.download(name);
    res.set({ 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename="${name}"` });
    const stream = createReadStream(file);
    stream.on('close', () => void cleanup());
    stream.pipe(res);
  }

  @Delete('files/:name')
  async remove(@CurrentUser() user: AuthUser, @Param('name') name: string) {
    await this.backups.remove(name, user.id);
    return { ok: true };
  }

  /** Restore runs to completion before answering; Trigon restarts right after. */
  @Post('files/:name/restore')
  @HttpCode(200)
  async restore(@CurrentUser() user: AuthUser, @Param('name') name: string, @Body() dto: RestoreDto) {
    if (dto.confirm !== name) throw new BadRequestException('Type the backup name to confirm.');
    await this.backups.restore(name, user.id, () => {
      // Docker's restart policy brings the API back with fresh caches and live documents.
      setTimeout(() => {
        this.logger.warn('Restarting after restore');
        process.exit(0);
      }, 1500);
    });
    return { ok: true, restarting: true };
  }
}
