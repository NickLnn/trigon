import { Module } from '@nestjs/common';
import { CollabService } from './collab.service';

@Module({ providers: [CollabService] })
export class CollabModule {}
