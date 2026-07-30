/* global __ENV */

import { check, group } from 'k6';
import http from 'k6/http';
import { Rate, Trend } from 'k6/metrics';

const baseUrl = __ENV.EVENTA_BASE_URL || 'http://host.docker.internal:3004';

const configurationCorrect = new Rate('configuration_correct');
const attendeeSessionCorrect = new Rate('attendee_session_correct');
const adminSessionCorrect = new Rate('admin_session_correct');
const attendeeLoginDuration = new Trend('attendee_login_duration', true);
const attendeeAccountDuration = new Trend('attendee_account_duration', true);
const attendeeLogoutDuration = new Trend('attendee_logout_duration', true);
const adminLoginDuration = new Trend('admin_login_duration', true);
const adminAccountDuration = new Trend('admin_account_duration', true);
const adminLogoutDuration = new Trend('admin_logout_duration', true);

export const options = {
  discardResponseBodies: false,
  scenarios: {
    authentication_session_lifecycle: {
      executor: 'per-vu-iterations',
      iterations: 1,
      maxDuration: '30s',
      vus: 1,
    },
  },
  summaryTrendStats: ['min', 'med', 'max'],
  thresholds: {
    admin_account_duration: ['max<5000'],
    admin_login_duration: ['max<5000'],
    admin_logout_duration: ['max<5000'],
    admin_session_correct: ['rate==1'],
    attendee_account_duration: ['max<5000'],
    attendee_login_duration: ['max<5000'],
    attendee_logout_duration: ['max<5000'],
    attendee_session_correct: ['rate==1'],
    checks: ['rate==1'],
    configuration_correct: ['rate==1'],
  },
};

function requireEnvironment(name) {
  const value = __ENV[name]?.trim();

  if (!value) {
    configurationCorrect.add(false);
    throw new Error(`${name}_IS_REQUIRED`);
  }

  configurationCorrect.add(true);
  return value;
}

function request(method, path, body, operation) {
  const params = {
    headers: { 'content-type': 'application/json' },
    tags: {
      name: `${method} ${path}`,
      operation,
    },
  };

  switch (method) {
    case 'GET':
      return http.get(`${baseUrl}${path}`, params);
    case 'POST':
      return http.post(
        `${baseUrl}${path}`,
        body === undefined ? null : JSON.stringify(body),
        params,
      );
    default:
      throw new Error(`UNSUPPORTED_METHOD_${method}`);
  }
}

function responseJson(response) {
  try {
    return response.json();
  } catch {
    return undefined;
  }
}

function validateSession({
  accountIdField,
  accountPath,
  correct,
  credentials,
  invalidSessionCode,
  loginDuration,
  loginPath,
  logoutDuration,
  logoutPath,
  accountDuration,
  operationPrefix,
}) {
  const login = request(
    'POST',
    loginPath,
    credentials,
    `${operationPrefix}_login`,
  );
  const loginBody = responseJson(login);
  const accountId = loginBody?.[accountIdField];
  const loggedIn = check(login, {
    [`${operationPrefix} login returns 200`]: () => login.status === 200,
    [`${operationPrefix} login returns account identity`]: () =>
      typeof accountId === 'string' && accountId.length > 0,
  });

  loginDuration.add(login.timings.duration);

  if (!loggedIn) {
    correct.add(false);
    return;
  }

  const account = request(
    'GET',
    accountPath,
    undefined,
    `${operationPrefix}_account`,
  );
  const accountBody = responseJson(account);
  const accountResolved = check(account, {
    [`${operationPrefix} account returns 200`]: () => account.status === 200,
    [`${operationPrefix} account matches the session`]: () =>
      accountBody?.[accountIdField] === accountId,
  });

  accountDuration.add(account.timings.duration);

  const logout = request(
    'POST',
    logoutPath,
    undefined,
    `${operationPrefix}_logout`,
  );
  const loggedOut = check(logout, {
    [`${operationPrefix} logout returns 204`]: () => logout.status === 204,
  });

  logoutDuration.add(logout.timings.duration);

  const rejectedAccount = request(
    'GET',
    accountPath,
    undefined,
    `${operationPrefix}_account_after_logout`,
  );
  const rejectedBody = responseJson(rejectedAccount);
  const sessionRevoked = check(rejectedAccount, {
    [`${operationPrefix} session is rejected after logout`]: () =>
      rejectedAccount.status === 401 &&
      rejectedBody?.code === invalidSessionCode,
  });

  correct.add(accountResolved && loggedOut && sessionRevoked);
}

export default function authenticationSessionLifecycle() {
  const attendeeCredentials = {
    email: requireEnvironment('EVENTA_ATTENDEE_EMAIL'),
    password: requireEnvironment('EVENTA_ATTENDEE_PASSWORD'),
  };
  const adminCredentials = {
    email: requireEnvironment('EVENTA_ADMIN_EMAIL'),
    password: requireEnvironment('EVENTA_ADMIN_PASSWORD'),
  };

  group('attendee session', () => {
    validateSession({
      accountDuration: attendeeAccountDuration,
      accountIdField: 'attendeeId',
      accountPath: '/auth/attendees/me',
      correct: attendeeSessionCorrect,
      credentials: attendeeCredentials,
      invalidSessionCode: 'SESSION_INVALID',
      loginDuration: attendeeLoginDuration,
      loginPath: '/auth/attendees/login',
      logoutDuration: attendeeLogoutDuration,
      logoutPath: '/auth/attendees/logout',
      operationPrefix: 'attendee',
    });
  });

  group('admin session', () => {
    validateSession({
      accountDuration: adminAccountDuration,
      accountIdField: 'adminId',
      accountPath: '/auth/admins/me',
      correct: adminSessionCorrect,
      credentials: adminCredentials,
      invalidSessionCode: 'ADMIN_SESSION_INVALID',
      loginDuration: adminLoginDuration,
      loginPath: '/auth/admins/login',
      logoutDuration: adminLogoutDuration,
      logoutPath: '/auth/admins/logout',
      operationPrefix: 'admin',
    });
  });
}
