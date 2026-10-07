import { Controller, Get } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Public } from './common/decorators';
import { Database, InjectDb } from './db/db.module';

@Controller('health')
export class HealthController {
  constructor(@InjectDb() private readonly db: Database) {}

  @Public()
  @Get()
  async check() {
    await this.db.execute(sql`select 1`);
    return { status: 'ok', time: new Date().toISOString() };
  }
}
