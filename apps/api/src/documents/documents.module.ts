import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { DocumentsController } from './documents.controller';
import { TrashController, TrashService } from './trash.controller';

@Module({ imports: [FilesModule], controllers: [DocumentsController, TrashController], providers: [TrashService] })
export class DocumentsModule {}
