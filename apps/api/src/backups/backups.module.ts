import { Module } from '@nestjs/common';
import { BackupsController } from './backups.controller';
import { BackupService } from './backup.service';

@Module({ controllers: [BackupsController], providers: [BackupService] })
export class BackupsModule {}
