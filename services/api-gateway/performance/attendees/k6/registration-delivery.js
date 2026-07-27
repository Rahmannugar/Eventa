import { check } from 'k6';
import { Rate, Trend } from 'k6/metrics';

import {
  captureDeliverySnapshot,
  configurationCorrect,
  postJson,
  requireEnvironment,
  responseJson,
  waitForDurableDelivery,
} from './support.js';

const registrationCorrect = new Rate('registration_correct');
const registrationDuration = new Trend('registration_http_duration', true);
const deliveryCorrect = new Rate('registration_delivery_correct');
const deliveryDuration = new Trend('registration_delivery_duration', true);

export const options = {
  discardResponseBodies: false,
  scenarios: {
    registration_delivery: {
      executor: 'per-vu-iterations',
      iterations: 1,
      maxDuration: '1m',
      vus: 1,
    },
  },
  summaryTrendStats: ['min', 'med', 'max'],
  thresholds: {
    checks: ['rate==1'],
    configuration_correct: ['rate==1'],
    registration_correct: ['rate==1'],
    registration_delivery_correct: ['rate==1'],
    registration_delivery_duration: ['max<15000'],
    registration_http_duration: ['max<4000'],
  },
};

export default function registrationDelivery() {
  configurationCorrect.add(true);
  const email = requireEnvironment('EVENTA_ATTENDEE_EMAIL');
  const password = requireEnvironment('EVENTA_ATTENDEE_PASSWORD');
  const username = requireEnvironment('EVENTA_ATTENDEE_USERNAME');
  const cutoff = captureDeliverySnapshot();
  const initiatedAt = Date.now();
  const response = postJson(
    '/auth/attendees/register',
    { email, password, username },
    'attendee_registration',
  );
  const body = responseJson(response);
  const correct = check(response, {
    'registration returns 201': () => response.status === 201,
    'registration returns the unverified attendee': () =>
      typeof body?.attendeeId === 'string' &&
      body?.email === email.toLowerCase() &&
      body?.username === username.toLowerCase() &&
      body?.emailVerified === false,
  });

  registrationDuration.add(response.timings.duration);
  registrationCorrect.add(correct);

  if (!correct) {
    deliveryCorrect.add(false);
    return;
  }

  waitForDurableDelivery({
    cutoff,
    durationTrend: deliveryDuration,
    initiatedAt,
    outcomeRate: deliveryCorrect,
  });
}
