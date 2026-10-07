import { Module } from '@nestjs/common';
import { EmbedsController } from './embeds.controller';
import { EmbedsService } from './embeds.service';

@Module({ controllers: [EmbedsController], providers: [EmbedsService] })
export class EmbedsModule {}
