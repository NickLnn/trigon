import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export const DB = Symbol('DB');
export const PG_POOL = Symbol('PG_POOL');
export type Database = NodePgDatabase<typeof schema>;
/** Inject the Drizzle client: `constructor(@InjectDb() private db: Database)`. */
export const InjectDb = () => Inject(DB);

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        // Without DATABASE_URL, pg falls back to PGHOST/PGUSER/PGPASSWORD/PGDATABASE (used in Docker,
        // so passwords with URL-special characters need no escaping).
        new Pool({ connectionString: config.get<string>('DATABASE_URL') || undefined, max: 20 }),
    },
    {
      provide: DB,
      inject: [PG_POOL],
      useFactory: (pool: Pool): Database => drizzle(pool, { schema }),
    },
  ],
  exports: [DB, PG_POOL],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown() {
    await this.pool.end();
  }
}
