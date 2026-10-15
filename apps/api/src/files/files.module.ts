import { Module } from '@nestjs/common';
import { TextIndexService } from '../search/text-index.service';
import { FilesController } from './files.controller';
import { StorageService } from './storage.service';

@Module({
  controllers: [FilesController],
  providers: [StorageService, TextIndexService],
  exports: [StorageService, TextIndexService],
})
export class FilesModule {}
