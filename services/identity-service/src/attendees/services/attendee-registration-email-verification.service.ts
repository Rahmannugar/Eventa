import { Inject, Logger } from '@nestjs/common';

import {
  ATTENDEE_EMAIL_VERIFICATION_SERVICE,
  EMAIL_VERIFICATION_JOB_PUBLISHER,
} from '../constants/attendee-email-verification.constants';
import type {
  AttendeeRegistrationEmailVerification,
  EmailVerificationOtpIssuer,
} from '../types/attendee-email-verification.types';
import type { EmailVerificationJobPublisher } from '../ports/email-verification-job.publisher';

export class AttendeeRegistrationEmailVerificationService implements AttendeeRegistrationEmailVerification {
  private readonly logger = new Logger(
    AttendeeRegistrationEmailVerificationService.name,
  );

  constructor(
    @Inject(ATTENDEE_EMAIL_VERIFICATION_SERVICE)
    private readonly emailVerification: EmailVerificationOtpIssuer,
    @Inject(EMAIL_VERIFICATION_JOB_PUBLISHER)
    private readonly jobPublisher: EmailVerificationJobPublisher,
  ) {}

  async start(attendeeId: string, email: string): Promise<void> {
    try {
      const issue = await this.emailVerification.issueInitial(
        attendeeId,
        email,
      );
      await this.jobPublisher.publish(issue);
    } catch (error: unknown) {
      this.logger.error({
        attendee_id: attendeeId,
        error_type: error instanceof Error ? error.name : 'UnknownError',
        event: 'initial_email_verification_job_failed',
      });
    }
  }
}
