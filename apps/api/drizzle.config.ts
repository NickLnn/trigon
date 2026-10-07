import { defineConfig } from 'drizzle-kit';

for (const file of ['.env', '../../.env']) {
  try {
    process.loadEnvFile(file);
  } catch {
    /* optional */
  }
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://trigon:change-me@localhost:5432/trigon' },
  strict: true,
});
