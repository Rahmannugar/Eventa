export interface RuntimeConfig {
  databaseUrl: string;
  eventGrpcDeadlineMs: number;
  eventGrpcUrl: string;
  healthPort: number;
  identityGrpcDeadlineMs: number;
  identityGrpcUrl: string;
  kafkaBrokers: string[];
  kafkaConsumerGroup: string;
  kafkaTicketRevokedTopic: string;
  rabbitMqConnectTimeoutMs: number;
  rabbitMqPublishTimeoutMs: number;
  rabbitMqUrl: string;
  resendApiKey: string;
  resendFrom: string;
  resendRequestTimeoutMs: number;
}

function readRequiredString(
  environment: NodeJS.ProcessEnv,
  name: string,
): string {
  const value = environment[name];

  if (value === undefined || value.trim() === '') {
    throw new Error(`${name} is required`);
  }

  return value.trim();
}

function readPositiveInteger(
  environment: NodeJS.ProcessEnv,
  name: string,
): number {
  const parsed = Number(readRequiredString(environment, name));

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function readPort(environment: NodeJS.ProcessEnv, name: string): number {
  const port = readPositiveInteger(environment, name);

  if (port > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }

  return port;
}

function readRabbitMqUrl(environment: NodeJS.ProcessEnv): string {
  const value = readRequiredString(environment, 'RABBITMQ_URL');
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error('RABBITMQ_URL must be a valid amqp:// or amqps:// URL');
  }

  if (!['amqp:', 'amqps:'].includes(url.protocol)) {
    throw new Error('RABBITMQ_URL must be a valid amqp:// or amqps:// URL');
  }

  return value;
}

export function readDatabaseUrl(environment: NodeJS.ProcessEnv): string {
  return readRequiredString(environment, 'DATABASE_URL');
}

function readBrokerList(
  environment: NodeJS.ProcessEnv,
  name: string,
): string[] {
  const brokers = readRequiredString(environment, name)
    .split(',')
    .map((broker) => broker.trim())
    .filter((broker) => broker !== '');
  if (brokers.length === 0) throw new Error(`${name} must list a broker`);
  for (const broker of brokers) {
    if (!/^[^\s:]+:\d{1,5}$/.test(broker)) {
      throw new Error(`${name} must use host:port entries`);
    }
  }
  return brokers;
}

function readKafkaName(environment: NodeJS.ProcessEnv, name: string): string {
  const value = readRequiredString(environment, name);
  if (!/^[a-zA-Z0-9._-]{1,249}$/.test(value)) {
    throw new Error(
      `${name} may only contain letters, digits, '.', '_' and '-'`,
    );
  }
  return value;
}

function readGrpcUrl(environment: NodeJS.ProcessEnv, name: string): string {
  const value = readRequiredString(environment, name);

  if (!/^[^\s:/]+:\d+$/.test(value)) {
    throw new Error(`${name} must use the host:port format`);
  }

  return value;
}

function readGrpcDeadlineMs(
  environment: NodeJS.ProcessEnv,
  name: string,
): number {
  const value = Number(readRequiredString(environment, name));

  if (!Number.isSafeInteger(value) || value < 100 || value > 10_000) {
    throw new Error(`${name} must be an integer between 100 and 10000`);
  }

  return value;
}

export function readRuntimeConfig(
  environment: NodeJS.ProcessEnv,
): RuntimeConfig {
  const eventGrpcUrl = readGrpcUrl(environment, 'EVENT_GRPC_URL');
  const identityGrpcUrl = readGrpcUrl(environment, 'IDENTITY_GRPC_URL');
  const eventGrpcDeadlineMs = readGrpcDeadlineMs(
    environment,
    'EVENT_GRPC_DEADLINE_MS',
  );
  const identityGrpcDeadlineMs = readGrpcDeadlineMs(
    environment,
    'IDENTITY_GRPC_DEADLINE_MS',
  );
  const resendRequestTimeoutMs = readPositiveInteger(
    environment,
    'RESEND_REQUEST_TIMEOUT_MS',
  );

  if (resendRequestTimeoutMs > 20_000) {
    throw new Error(
      'RESEND_REQUEST_TIMEOUT_MS must not exceed 20000 milliseconds',
    );
  }

  return {
    databaseUrl: readDatabaseUrl(environment),
    eventGrpcDeadlineMs,
    eventGrpcUrl,
    healthPort: readPort(environment, 'HEALTH_PORT'),
    identityGrpcDeadlineMs,
    identityGrpcUrl,
    kafkaBrokers: readBrokerList(environment, 'KAFKA_BROKERS'),
    kafkaConsumerGroup: readKafkaName(environment, 'KAFKA_CONSUMER_GROUP'),
    kafkaTicketRevokedTopic: readKafkaName(
      environment,
      'KAFKA_TICKET_REVOKED_TOPIC',
    ),
    rabbitMqConnectTimeoutMs: readPositiveInteger(
      environment,
      'RABBITMQ_CONNECT_TIMEOUT_MS',
    ),
    rabbitMqPublishTimeoutMs: readPositiveInteger(
      environment,
      'RABBITMQ_PUBLISH_TIMEOUT_MS',
    ),
    rabbitMqUrl: readRabbitMqUrl(environment),
    resendApiKey: readRequiredString(environment, 'RESEND_API_KEY'),
    resendFrom: readRequiredString(environment, 'RESEND_FROM'),
    resendRequestTimeoutMs,
  };
}
