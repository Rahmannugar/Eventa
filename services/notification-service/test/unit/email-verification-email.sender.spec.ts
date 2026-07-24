import { describe, expect, it } from 'vitest';

import type { EmailDeliveryProvider } from '../../src/notifications/ports/email-delivery.provider';
import { EmailVerificationEmailSender } from '../../src/notifications/services/email-verification-email.sender';
import type { EmailDeliveryRequest } from '../../src/notifications/types/email.types';

class RecordingEmailDeliveryProvider implements EmailDeliveryProvider {
  messages: EmailDeliveryRequest[] = [];

  send(email: EmailDeliveryRequest): Promise<{ messageId: string }> {
    this.messages.push(email);
    return Promise.resolve({ messageId: 'provider-message-1' });
  }
}

describe('EmailVerificationEmailSender', () => {
  it('owns verification content and passes the job ID as client idempotency key', async () => {
    const provider = new RecordingEmailDeliveryProvider();
    const sender = new EmailVerificationEmailSender(
      provider,
      'Eventa <onboarding@resend.dev>',
    );

    await expect(
      sender.send({
        jobId: '9f004a41-8ca1-46f4-b254-2d16dcc88520',
        otp: '123456',
        recipientEmail: 'attendee@example.com',
      }),
    ).resolves.toEqual({ providerMessageId: 'provider-message-1' });
    expect(provider.messages).toHaveLength(1);
    expect(provider.messages[0]).toMatchObject({
      from: 'Eventa <onboarding@resend.dev>',
      idempotencyKey: '9f004a41-8ca1-46f4-b254-2d16dcc88520',
      subject: 'Verify your Eventa email',
      to: 'attendee@example.com',
    });
    expect(provider.messages[0]?.html).toContain('123456');
    expect(provider.messages[0]?.text).toContain('123456');
  });
});
