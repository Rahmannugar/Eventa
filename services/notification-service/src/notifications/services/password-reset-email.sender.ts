import { Inject } from '@nestjs/common';

import { EMAIL_DELIVERY_PROVIDER } from '../constants/email-verification-delivery.constants';
import type { EmailDeliveryProvider } from '../ports/email-delivery.provider';
import type {
  PasswordResetEmail,
  PasswordResetEmailSender as PasswordResetEmailSenderPort,
} from '../types/password-reset-delivery.types';

export class PasswordResetEmailSender implements PasswordResetEmailSenderPort {
  constructor(
    @Inject(EMAIL_DELIVERY_PROVIDER)
    private readonly emailDeliveryProvider: EmailDeliveryProvider,
    private readonly from: string,
  ) {}

  async send(
    email: PasswordResetEmail,
  ): Promise<{ providerMessageId: string }> {
    const result = await this.emailDeliveryProvider.send({
      from: this.from,
      html: this.renderHtml(email.code),
      idempotencyKey: email.jobId,
      subject: 'Reset your Eventa password',
      text: this.renderText(email.code),
      to: email.recipientEmail,
    });

    return { providerMessageId: result.messageId };
  }

  private renderHtml(code: string): string {
    return [
      '<p>Use this one-time code to reset your Eventa password:</p>',
      `<p><strong>${code}</strong></p>`,
      '<p>This code expires in 15 minutes. If you did not request a password reset, you can ignore this email.</p>',
    ].join('');
  }

  private renderText(code: string): string {
    return `Use ${code} to reset your Eventa password. This code expires in 15 minutes. If you did not request a password reset, you can ignore this email.`;
  }
}
