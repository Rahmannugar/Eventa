import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const scenarios = {
  confirmation: {
    requiredEnvironment: ['EVENTA_ATTENDEE_EMAIL', 'EVENTA_ATTENDEE_OTP'],
    script: 'confirmation.js',
  },
  registration: {
    requiredEnvironment: [
      'EVENTA_ATTENDEE_EMAIL',
      'EVENTA_ATTENDEE_PASSWORD',
      'EVENTA_ATTENDEE_USERNAME',
    ],
    script: 'registration-delivery.js',
    observesDelivery: true,
  },
  resend: {
    requiredEnvironment: ['EVENTA_ATTENDEE_EMAIL'],
    script: 'resend-delivery.js',
    observesDelivery: true,
  },
};

const scenarioName = process.argv[2];
const scenario = scenarios[scenarioName];

if (scenario === undefined) {
  console.error(
    'Choose one attendee scenario: registration, resend, confirmation',
  );
  process.exit(1);
}

const missingEnvironment = scenario.requiredEnvironment.filter(
  (name) => !process.env[name]?.trim(),
);

if (missingEnvironment.length > 0) {
  console.error(
    `Missing required environment: ${missingEnvironment.join(', ')}`,
  );
  process.exit(1);
}

function replaceHost(urlValue, fromHosts, toHost) {
  const url = new URL(urlValue);

  if (fromHosts.includes(url.hostname)) {
    url.hostname = toHost;
  }

  return url.toString().replace(/\/$/, '');
}

if (scenario.observesDelivery === true) {
  const configuredObserverUrl =
    process.env.EVENTA_DELIVERY_OBSERVER_URL ?? 'http://127.0.0.1:3016';
  const hostObserverUrl = replaceHost(
    configuredObserverUrl,
    ['host.docker.internal'],
    '127.0.0.1',
  );

  try {
    const response = await fetch(`${hostObserverUrl}/health`, {
      signal: AbortSignal.timeout(2_000),
    });

    if (!response.ok) {
      throw new Error('DELIVERY_OBSERVER_NOT_READY');
    }
  } catch {
    console.error(
      'Notification delivery observer is unavailable. Start it with: pnpm --filter @eventa/notification-service performance:notifications:observe-deliveries',
    );
    process.exit(1);
  }
}

const dockerArguments = [
  'run',
  '--rm',
  '--add-host',
  'host.docker.internal:host-gateway',
];

for (const name of scenario.requiredEnvironment) {
  dockerArguments.push('-e', name);
}

dockerArguments.push(
  '-e',
  `EVENTA_BASE_URL=${replaceHost(
    process.env.EVENTA_BASE_URL ?? 'http://127.0.0.1:3004',
    ['127.0.0.1', 'localhost'],
    'host.docker.internal',
  )}`,
);

if (scenario.observesDelivery === true) {
  const deliveryObserverUrl = replaceHost(
    process.env.EVENTA_DELIVERY_OBSERVER_URL ?? 'http://127.0.0.1:3016',
    ['127.0.0.1', 'localhost'],
    'host.docker.internal',
  );
  dockerArguments.push(
    '-e',
    `EVENTA_DELIVERY_OBSERVER_URL=${deliveryObserverUrl}`,
  );

  if (process.env.EVENTA_DELIVERY_TIMEOUT_MS !== undefined) {
    dockerArguments.push('-e', 'EVENTA_DELIVERY_TIMEOUT_MS');
  }
}

dockerArguments.push(
  '-v',
  `${resolve(import.meta.dirname, 'k6')}:/scripts:ro`,
  'grafana/k6:2.1.0',
  'run',
  `/scripts/${scenario.script}`,
);

const result = spawnSync('docker', dockerArguments, {
  env: process.env,
  stdio: 'inherit',
});

if (result.error !== undefined) {
  console.error(`Unable to start k6: ${result.error.name}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
