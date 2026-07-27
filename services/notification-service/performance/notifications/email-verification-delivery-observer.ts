import { createServer, type ServerResponse } from 'node:http';

import postgres from 'postgres';

const TERMINAL_DELIVERY_STATUSES = new Set([
  'delivered',
  'expired',
  'failed',
  'rejected',
]);

interface SnapshotRow {
  cutoff: Date | string;
}

interface DeliveryRow {
  created_at: Date | string;
  status: string;
  terminal_at: Date | string | null;
}

function readRequiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();

  if (value === undefined || value === '') {
    throw new Error(`${name} is required`);
  }

  return value;
}

function readPort(): number {
  const rawValue = process.env.PERFORMANCE_OBSERVER_PORT?.trim() ?? '3016';
  const port = Number(rawValue);

  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(
      'PERFORMANCE_OBSERVER_PORT must be an integer between 1 and 65535',
    );
  }

  return port;
}

function readTimestamp(value: Date | string): string {
  const timestamp = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(timestamp.getTime())) {
    throw new Error('PERFORMANCE_DELIVERY_TIMESTAMP_INVALID');
  }

  return timestamp.toISOString();
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: object,
): void {
  response.writeHead(statusCode, {
    'cache-control': 'no-store',
    'content-type': 'application/json',
  });
  response.end(JSON.stringify(body));
}

const database = postgres(readRequiredEnvironment('PERFORMANCE_DATABASE_URL'), {
  max: 2,
});
const host = process.env.PERFORMANCE_OBSERVER_HOST?.trim() || '127.0.0.1';
const port = readPort();

const server = createServer((request, response) => {
  void handleRequest(request.url, response).catch((error: unknown) => {
    console.error(
      JSON.stringify({
        error_type: error instanceof Error ? error.name : 'UnknownError',
        event: 'performance_delivery_observer_error',
      }),
    );
    sendJson(response, 500, {
      errorCode: 'PERFORMANCE_DELIVERY_OBSERVER_UNAVAILABLE',
    });
  });
});

async function handleRequest(
  rawUrl: string | undefined,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(rawUrl ?? '/', `http://${host}:${String(port)}`);

  if (url.pathname === '/health') {
    await database`SELECT 1`;
    sendJson(response, 200, { ready: true });
    return;
  }

  if (url.pathname === '/snapshot') {
    const [snapshot] = await database<SnapshotRow[]>`
      SELECT COALESCE(
        MAX(created_at),
        TIMESTAMPTZ '1970-01-01T00:00:00.000Z'
      ) AS cutoff
      FROM email_verification_deliveries
    `;

    if (snapshot === undefined) {
      throw new Error('PERFORMANCE_DELIVERY_SNAPSHOT_UNAVAILABLE');
    }

    sendJson(response, 200, { cutoff: readTimestamp(snapshot.cutoff) });
    return;
  }

  if (url.pathname === '/next') {
    const after = url.searchParams.get('after');
    const afterTimestamp = after === null ? undefined : new Date(after);

    if (
      afterTimestamp === undefined ||
      Number.isNaN(afterTimestamp.getTime())
    ) {
      sendJson(response, 400, {
        errorCode: 'PERFORMANCE_DELIVERY_CUTOFF_INVALID',
      });
      return;
    }

    const [delivery] = await database<DeliveryRow[]>`
      SELECT created_at, status, terminal_at
      FROM email_verification_deliveries
      WHERE created_at > ${afterTimestamp.toISOString()}
      ORDER BY created_at ASC
      LIMIT 1
    `;

    if (delivery === undefined) {
      response.writeHead(204, { 'cache-control': 'no-store' });
      response.end();
      return;
    }

    sendJson(response, 200, {
      createdAt: readTimestamp(delivery.created_at),
      status: delivery.status,
      terminal: TERMINAL_DELIVERY_STATUSES.has(delivery.status),
      ...(delivery.terminal_at === null
        ? {}
        : { terminalAt: readTimestamp(delivery.terminal_at) }),
    });
    return;
  }

  sendJson(response, 404, {
    errorCode: 'PERFORMANCE_DELIVERY_OBSERVER_ROUTE_NOT_FOUND',
  });
}

let shuttingDown = false;

async function shutdown(): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
        return;
      }

      reject(error);
    });
  });
  await database.end({ timeout: 5 });
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

server.listen(port, host, () => {
  console.log(
    JSON.stringify({
      event: 'performance_delivery_observer_ready',
      host,
      port,
    }),
  );
});
