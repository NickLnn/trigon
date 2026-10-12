import { Module } from '@nestjs/common';
import { VersionsController } from '../versions/versions.controller';
import { VersionsService } from '../versions/versions.service';
import { CollabService } from './collab.service';

@Module({ controllers: [VersionsController], providers: [CollabService, VersionsService] })
export class CollabModule {}
