import { Controller, Get, Query } from '@nestjs/common';
import { and, asc, eq, ilike, or } from 'drizzle-orm';
import { Database, InjectDb } from '../db/db.module';
import { groups, users } from '../db/schema';

/** Directory lookups used by share dialogs and mentions. */
@Controller()
export class UsersController {
  constructor(@InjectDb() private readonly db: Database) {}

  @Get('users')
  async searchUsers(@Query('q') q = '') {
    const term = `%${q.trim()}%`;
    return this.db
      .select({ id: users.id, email: users.email, displayName: users.displayName, avatarUrl: users.avatarUrl })
      .from(users)
      .where(and(eq(users.active, true), q ? or(ilike(users.displayName, term), ilike(users.email, term)) : undefined))
      .orderBy(asc(users.displayName))
      .limit(25);
  }

  @Get('groups')
  async searchGroups(@Query('q') q = '') {
    return this.db
      .select({ id: groups.id, name: groups.name, source: groups.source })
      .from(groups)
      .where(q ? ilike(groups.name, `%${q.trim()}%`) : undefined)
      .orderBy(asc(groups.name))
      .limit(25);
  }
}
