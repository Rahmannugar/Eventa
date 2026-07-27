/* global __ENV */

import { check, sleep } from 'k6';
import http from 'k6/http';
import { Rate } from 'k6/metrics';

const observerUrl =
  __ENV.EVENTA_DELIVERY_OBSERVER_URL || 'http://127.0.0.1:3016';
export const configurationCorrect = new Rate('configuration_correct');

function readJson(response) {
  try {
    return response.json();
  } catch {
    return undefined;
  }
}

export function captureDeliverySnapshot() {
  const response = http.get(`${observerUrl}/snapshot`, {
    tags: {
      name: 'GET /performance/deliveries/snapshot',
      operation: 'performance_delivery_snapshot',
    },
  });
  const body = readJson(response);
  const valid = check(response, {
    'delivery observer snapshot is available': () =>
      response.status === 200 && typeof body?.cutoff === 'string',
  });

  if (!valid) {
    throw new Error('DELIVERY_OBSERVER_SNAPSHOT_UNAVAILABLE');
  }

  return body.cutoff;
}

export function waitForDurableDelivery({
  cutoff,
  initiatedAt,
  outcomeRate,
  durationTrend,
}) {
  const timeoutMs = Number(__ENV.EVENTA_DELIVERY_TIMEOUT_MS || '15000');
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const response = http.get(
      `${observerUrl}/next?after=${encodeURIComponent(cutoff)}`,
      {
        tags: {
          name: 'GET /performance/deliveries/next',
          operation: 'performance_delivery_next',
        },
      },
    );

    if (response.status === 204) {
      sleep(0.1);
      continue;
    }

    const body = readJson(response);
    const validResponse = check(response, {
      'delivery observer response is valid': () =>
        response.status === 200 &&
        typeof body?.status === 'string' &&
        typeof body?.terminal === 'boolean',
    });

    if (!validResponse) {
      outcomeRate.add(false);
      return;
    }

    if (!body.terminal) {
      sleep(0.1);
      continue;
    }

    const delivered = body.status === 'delivered';
    outcomeRate.add(delivered);
    durationTrend.add(Date.now() - initiatedAt);
    check(response, {
      'delivery reached durable delivered state': () => delivered,
    });
    return;
  }

  durationTrend.add(Date.now() - initiatedAt);
  outcomeRate.add(false);
  check(null, {
    'delivery reached a durable terminal state before timeout': () => false,
  });
}

export function postJson(path, body, operation) {
  return http.post(
    `${__ENV.EVENTA_BASE_URL || 'http://127.0.0.1:3004'}${path}`,
    JSON.stringify(body),
    {
      headers: {
        'content-type': 'application/json',
        'x-request-id': `k6-${operation}-${Date.now()}`,
      },
      tags: {
        name: `POST ${path}`,
        operation,
      },
    },
  );
}

export function requireEnvironment(name) {
  const value = __ENV[name]?.trim();

  if (!value) {
    configurationCorrect.add(false);
    throw new Error(`${name}_IS_REQUIRED`);
  }

  configurationCorrect.add(true);
  return value;
}

export function responseJson(response) {
  return readJson(response);
}
