/**
 * Applies pending SQL migrations from ./drizzle. Run by the Docker image on start:
 *   node dist/db/migrate.js
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { join } from 'node:path';
import { Pool } from 'pg';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
  await migrate(drizzle(pool), { migrationsFolder: join(__dirname, '../../drizzle') });
  await pool.end();
  console.log('Migrations applied');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
