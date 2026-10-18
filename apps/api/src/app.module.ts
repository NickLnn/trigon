import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { ActivityModule } from './activity/activity.module';
import { BackupsModule } from './backups/backups.module';
import { AuthModule } from './auth/auth.module';
import { CollabModule } from './collab/collab.module';
import { CommentsModule } from './comments/comments.module';
import { validateEnv } from './common/env';
import { JwtAuthGuard, RolesGuard } from './common/guards';
import { ClientThrottlerGuard } from './common/throttler.guard';
import { DbModule } from './db/db.module';
import { DirectoryModule } from './directory/directory.module';
import { DocumentsModule } from './documents/documents.module';
import { EmbedsModule } from './embeds/embeds.module';
import { FilesModule } from './files/files.module';
import { HealthController } from './health.controller';
import { IconsModule } from './icons/icons.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PermissionsModule } from './permissions/permissions.module';
import { ReviewsModule } from './reviews/reviews.module';
import { SearchModule } from './search/search.module';
import { SettingsCoreModule, SettingsModule } from './settings/settings.module';
import { SpacesModule } from './spaces/spaces.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    // .env in apps/api, falling back to the monorepo root
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../../.env'], validate: validateEnv }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    DbModule,
    ActivityModule,
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
    NotificationsModule,
    ReviewsModule,
    BackupsModule,
    SearchModule,
    CommentsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ClientThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
