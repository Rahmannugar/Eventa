import { check } from 'k6';
import { Rate, Trend } from 'k6/metrics';

import {
  configurationCorrect,
  postJson,
  requireEnvironment,
  responseJson,
} from './support.js';

const confirmationCorrect = new Rate('confirmation_correct');
const confirmationDuration = new Trend('confirmation_http_duration', true);
const replayCorrect = new Rate('confirmation_replay_correct');
const replayDuration = new Trend('confirmation_replay_http_duration', true);

export const options = {
  discardResponseBodies: false,
  scenarios: {
    confirmation_and_replay: {
      executor: 'per-vu-iterations',
      iterations: 1,
      maxDuration: '15s',
      vus: 1,
    },
  },
  summaryTrendStats: ['min', 'med', 'max'],
  thresholds: {
    checks: ['rate==1'],
    configuration_correct: ['rate==1'],
    confirmation_correct: ['rate==1'],
    confirmation_http_duration: ['max<4000'],
    confirmation_replay_correct: ['rate==1'],
    confirmation_replay_http_duration: ['max<4000'],
  },
};

export default function confirmationAndReplay() {
  configurationCorrect.add(true);
  const email = requireEnvironment('EVENTA_ATTENDEE_EMAIL');
  const otp = requireEnvironment('EVENTA_ATTENDEE_OTP');
  const request = { email, otp };
  const confirmation = postJson(
    '/auth/attendees/email-verification/confirm',
    request,
    'attendee_email_verification_confirm',
  );
  const confirmationBody = responseJson(confirmation);
  const confirmed = check(confirmation, {
    'confirmation returns 200': () => confirmation.status === 200,
    'confirmation returns verified state': () =>
      confirmationBody?.emailVerified === true,
  });

  confirmationDuration.add(confirmation.timings.duration);
  confirmationCorrect.add(confirmed);

  if (!confirmed) {
    replayCorrect.add(false);
    return;
  }

  const replay = postJson(
    '/auth/attendees/email-verification/confirm',
    request,
    'attendee_email_verification_confirm_replay',
  );
  const replayBody = responseJson(replay);
  const replayed = check(replay, {
    'confirmation replay returns 200': () => replay.status === 200,
    'confirmation replay remains verified': () =>
      replayBody?.emailVerified === true,
  });

  replayDuration.add(replay.timings.duration);
  replayCorrect.add(replayed);
}
