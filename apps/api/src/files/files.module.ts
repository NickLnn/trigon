import { Module } from '@nestjs/common';
import { TextIndexService } from '../search/text-index.service';
import { FilesController } from './files.controller';
import { StorageOverviewController } from './storage-overview.controller';
import { StorageService } from './storage.service';

@Module({
  controllers: [FilesController, StorageOverviewController],
  providers: [StorageService, TextIndexService],
  exports: [StorageService, TextIndexService],
})
export class FilesModule {}
