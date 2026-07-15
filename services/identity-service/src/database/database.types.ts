import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';

export type IdentityDatabase = PostgresJsDatabase;
export type PostgresClient = ReturnType<typeof postgres>;
