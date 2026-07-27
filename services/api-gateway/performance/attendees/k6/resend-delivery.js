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

const resendCorrect = new Rate('resend_correct');
const resendDuration = new Trend('resend_http_duration', true);
const deliveryCorrect = new Rate('resend_delivery_correct');
const deliveryDuration = new Trend('resend_delivery_duration', true);

export const options = {
  discardResponseBodies: false,
  scenarios: {
    resend_delivery: {
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
    resend_correct: ['rate==1'],
    resend_delivery_correct: ['rate==1'],
    resend_delivery_duration: ['max<15000'],
    resend_http_duration: ['max<4000'],
  },
};

export default function resendDelivery() {
  configurationCorrect.add(true);
  const email = requireEnvironment('EVENTA_ATTENDEE_EMAIL');
  const cutoff = captureDeliverySnapshot();
  const initiatedAt = Date.now();
  const response = postJson(
    '/auth/attendees/email-verification/resend',
    { email },
    'attendee_email_verification_resend',
  );
  const body = responseJson(response);
  const correct = check(response, {
    'resend returns 202': () => response.status === 202,
    'resend returns the generic accepted response': () =>
      body?.accepted === true,
  });

  resendDuration.add(response.timings.duration);
  resendCorrect.add(correct);

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
