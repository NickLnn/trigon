import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { CollabModule } from './collab/collab.module';
import { JwtAuthGuard, RolesGuard } from './common/guards';
import { DbModule } from './db/db.module';
import { DirectoryModule } from './directory/directory.module';
import { DocumentsModule } from './documents/documents.module';
import { EmbedsModule } from './embeds/embeds.module';
import { FilesModule } from './files/files.module';
import { HealthController } from './health.controller';
import { IconsModule } from './icons/icons.module';
import { PermissionsModule } from './permissions/permissions.module';
import { SettingsCoreModule, SettingsModule } from './settings/settings.module';
import { SpacesModule } from './spaces/spaces.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    // .env in apps/api, falling back to the monorepo root
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../../.env'] }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    DbModule,
    SettingsCoreModule,
    UsersModule,
    PermissionsModule,
    DirectoryModule,
    AuthModule,
    SpacesModule,
    DocumentsModule,
    FilesModule,
    EmbedsModule,
    IconsModule,
    CollabModule,
    SettingsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
