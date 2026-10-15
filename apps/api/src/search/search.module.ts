import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { SearchSettingsController } from './search-settings.controller';

/** Admin settings for file text extraction / OCR (the indexer itself lives with FilesModule, which feeds it uploads). */
@Module({
  imports: [FilesModule],
  controllers: [SearchSettingsController],
})
export class SearchModule {}
