import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { AttendeeRegistrationEmailVerificationService } from '../../src/attendees/services/attendee-registration-email-verification.service';
import type { EmailVerificationOtpIssue } from '../../src/attendees/types/attendee-email-verification.types';
import type { EmailVerificationJobPublisher } from '../../src/attendees/ports/email-verification-job.publisher';

class IssuingEmailVerification {
  readonly issue: EmailVerificationOtpIssue = {
    accountId: 'attendee-1',
    email: 'attendee@example.com',
    otp: '123456',
  };

  issueInitial(): Promise<EmailVerificationOtpIssue> {
    return Promise.resolve(this.issue);
  }
}

class RecordingPublisher implements EmailVerificationJobPublisher {
  issues: EmailVerificationOtpIssue[] = [];

  publish(issue: EmailVerificationOtpIssue): Promise<void> {
    this.issues.push(issue);
    return Promise.resolve();
  }
}

describe('AttendeeRegistrationEmailVerificationService', () => {
  it('creates and queues the initial OTP after registration', async () => {
    const emailVerification = new IssuingEmailVerification();
    const publisher = new RecordingPublisher();
    const service = new AttendeeRegistrationEmailVerificationService(
      emailVerification,
      publisher,
    );

    await service.start('attendee-1', 'attendee@example.com');

    expect(publisher.issues).toEqual([emailVerification.issue]);
  });

  it('does not turn a queue failure into a second registration outcome', async () => {
    const logError = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const service = new AttendeeRegistrationEmailVerificationService(
      new IssuingEmailVerification(),
      {
        publish: () => Promise.reject(new Error('queue unavailable')),
      },
    );

    await expect(
      service.start('attendee-1', 'attendee@example.com'),
    ).resolves.toBeUndefined();
    expect(logError).toHaveBeenCalledWith({
      attendee_id: 'attendee-1',
      error_type: 'Error',
      event: 'initial_email_verification_job_failed',
    });
    logError.mockRestore();
  });
});
