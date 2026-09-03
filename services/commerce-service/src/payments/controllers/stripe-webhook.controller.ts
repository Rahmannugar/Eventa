import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  type RawBodyRequest,
  Req,
} from '@nestjs/common';

import { PAYMENT_PROVIDER_EVENT_HANDLING } from '../payments.tokens';
import type { PaymentProviderEventHandling } from '../types/payment-attempt.types';

@Controller('webhooks/stripe')
export class StripeWebhookController {
  constructor(
    @Inject(PAYMENT_PROVIDER_EVENT_HANDLING)
    private readonly events: PaymentProviderEventHandling,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(
    @Req() request: RawBodyRequest<object>,
    @Headers('stripe-signature') signature?: string,
  ): Promise<{ received: true }> {
    try {
      if (request.rawBody === undefined || signature === undefined) {
        throw new Error('PAYMENT_WEBHOOK_SIGNATURE_INVALID');
      }
      await this.events.handle(request.rawBody, signature);
      return { received: true };
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        error.message === 'PAYMENT_WEBHOOK_SIGNATURE_INVALID'
      ) {
        throw new BadRequestException({
          code: 'INVALID_STRIPE_WEBHOOK',
          message: 'Invalid webhook',
          statusCode: 400,
        });
      }
      throw error;
    }
  }
}
