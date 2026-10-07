import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { IconsController } from './icons.controller';
import { IconsService } from './icons.service';

@Module({ imports: [FilesModule], controllers: [IconsController], providers: [IconsService] })
export class IconsModule {}
