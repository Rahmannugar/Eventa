import { Inject } from '@nestjs/common';

import { EMAIL_DELIVERY_PROVIDER } from '../constants/email-verification-delivery.constants';
import type { EmailDeliveryProvider } from '../ports/email-delivery.provider';
import type {
  EmailVerificationEmail,
  EmailVerificationEmailSender as EmailVerificationEmailSenderPort,
} from '../types/email-verification-delivery.types';

export class EmailVerificationEmailSender implements EmailVerificationEmailSenderPort {
  constructor(
    @Inject(EMAIL_DELIVERY_PROVIDER)
    private readonly emailDeliveryProvider: EmailDeliveryProvider,
    private readonly from: string,
  ) {}

  async send(
    email: EmailVerificationEmail,
  ): Promise<{ providerMessageId: string }> {
    const result = await this.emailDeliveryProvider.send({
      from: this.from,
      html: this.renderHtml(email.otp),
      idempotencyKey: email.jobId,
      subject: 'Verify your Eventa email',
      text: this.renderText(email.otp),
      to: email.recipientEmail,
    });

    return { providerMessageId: result.messageId };
  }

  private renderHtml(otp: string): string {
    return [
      '<p>Use this one-time code to verify your Eventa email address:</p>',
      `<p><strong>${otp}</strong></p>`,
      '<p>This code expires in 15 minutes. If you did not create an Eventa account, you can ignore this email.</p>',
    ].join('');
  }

  private renderText(otp: string): string {
    return `Use ${otp} to verify your Eventa email address. This code expires in 15 minutes. If you did not create an Eventa account, you can ignore this email.`;
  }
}
