import { resolve } from 'node:path';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import { readDatabaseUrl } from '../config/runtime-config';

async function runMigrations(): Promise<void> {
  const client = postgres(readDatabaseUrl(process.env), { max: 1 });
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
