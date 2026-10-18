import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { BackupsController } from './backups.controller';
import { BackupService } from './backup.service';

@Module({ imports: [FilesModule], controllers: [BackupsController], providers: [BackupService] })
export class BackupsModule {}
