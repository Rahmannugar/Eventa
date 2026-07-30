import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';

export type EventDatabase = PostgresJsDatabase;
export type PostgresClient = ReturnType<typeof postgres>;
