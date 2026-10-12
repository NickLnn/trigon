import { Body, Controller, Get, Put } from '@nestjs/common';
import type { MyNotifications } from '@trigon/shared';
import { IsBoolean, IsIn } from 'class-validator';
import { eq } from 'drizzle-orm';
import { CurrentUser, type AuthUser } from '../common/decorators';
import { Database, InjectDb } from '../db/db.module';
import { users } from '../db/schema';
import { EmailService } from '../email/email.service';
import { prefsOf } from './notifications.service';

class PrefsDto {
  @IsBoolean() shares: boolean;
  @IsBoolean() account: boolean;
  @IsIn(['off', 'daily', 'weekly']) reviewDigest: 'off' | 'daily' | 'weekly';
}

/** Profile → Notifications: each person's own email choices. */
@Controller('me/notifications')
export class NotificationsController {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly email: EmailService,
  ) {}

  @Get()
  async get(@CurrentUser() user: AuthUser): Promise<MyNotifications> {
    const [row] = await this.db.select({ email: users.email, prefs: users.notificationPrefs }).from(users).where(eq(users.id, user.id));
    return { prefs: prefsOf(row?.prefs), email: row?.email ?? user.email, emailEnabled: await this.email.enabled() };
  }

  @Put()
  async save(@CurrentUser() user: AuthUser, @Body() dto: PrefsDto): Promise<MyNotifications> {
    await this.db.update(users).set({ notificationPrefs: { ...dto } }).where(eq(users.id, user.id));
    return this.get(user);
  }
}
