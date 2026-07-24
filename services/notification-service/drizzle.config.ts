import { defineConfig } from 'drizzle-kit';

import { readDatabaseUrl } from './src/config/runtime-config';

export default defineConfig({
  dialect: 'postgresql',
  out: './drizzle',
  schema: './src/notifications/schema/email-verification-delivery.schema.ts',
  dbCredentials: {
    url: readDatabaseUrl(process.env),
  },
});
