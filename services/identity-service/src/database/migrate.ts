import { resolve } from 'node:path';

import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { readDatabaseUrl } from '../config/runtime-config';

async function runMigrations(): Promise<void> {
  const databaseUrl = readDatabaseUrl(process.env);
  const client = postgres(databaseUrl, { max: 1 });
  const database = drizzle(client);

  try {
    await migrate(database, {
      migrationsFolder: resolve(process.cwd(), 'drizzle'),
    });
  } finally {
    await client.end();
  }
}

void runMigrations();
