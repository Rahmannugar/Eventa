import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

async function writeWhenMissing(relativePath, content) {
  const path = resolve(root, relativePath);

  if (existsSync(path)) {
    return false;
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, { encoding: 'utf8', mode: 0o600 });
  return true;
}

const databasePassword = 'eventa_identity_password';
const rateLimitSecret = randomBytes(32).toString('hex');
const encodedDatabasePassword = encodeURIComponent(databasePassword);

const identityCreated = await writeWhenMissing(
  'services/identity-service/.env',
  [
    'POSTGRES_DB=eventa_identity',
    'POSTGRES_USER=eventa_identity',
    `POSTGRES_PASSWORD=${databasePassword}`,
    `DATABASE_URL=postgres://eventa_identity:${encodedDatabasePassword}@identity-database:5432/eventa_identity`,
    `TEST_DATABASE_URL=postgres://eventa_identity:${encodedDatabasePassword}@127.0.0.1:55432/eventa_identity_test`,
    'GRPC_HOST=0.0.0.0',
    'GRPC_PORT=50051',
    'HEALTH_PORT=3005',
    '',
  ].join('\n'),
);

const gatewayCreated = await writeWhenMissing(
  'services/api-gateway/.env',
  [
    'PORT=3004',
    'API_DOCS_ENABLED=true',
    'IDENTITY_GRPC_URL=identity-service:50051',
    'REDIS_URL=redis://api-gateway-redis:6379',
    'TEST_REDIS_URL=redis://127.0.0.1:56379',
    `RATE_LIMIT_KEY_SECRET=${rateLimitSecret}`,
    'TRUST_PROXY_HOPS=0',
    '',
  ].join('\n'),
);

if (identityCreated || gatewayCreated) {
  process.stdout.write('Created missing local service environment files.\n');
}
