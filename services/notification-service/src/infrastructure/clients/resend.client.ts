import { runWithOperationSpan } from '@eventa/observability';

import { EmailDeliveryError } from '../../notifications/errors/email-delivery.errors';
import type { EmailDeliveryProvider } from '../../notifications/ports/email-delivery.provider';
import type {
  EmailDeliveryRequest,
  EmailDeliveryResult,
} from '../../notifications/types/email.types';

interface ResendErrorBody {
  name?: unknown;
}

interface ResendSuccessBody {
  id?: unknown;
}

const RESEND_API_URL = 'https://api.resend.com/emails';

export class ResendClient implements EmailDeliveryProvider {
  constructor(
    private readonly apiKey: string,
    private readonly requestTimeoutMs: number,
    private readonly fetchImplementation: typeof fetch = fetch,
    private readonly apiUrl: string = RESEND_API_URL,
  ) {}

  async send(email: EmailDeliveryRequest): Promise<EmailDeliveryResult> {
    return runWithOperationSpan(
      'resend.email.send',
      () => this.sendRequest(email),
      {
        attributes: {
          'http.request.method': 'POST',
          'server.address': new URL(this.apiUrl).hostname,
        },
        kind: 'client',
      },
    );
  }

  private async sendRequest(
    email: EmailDeliveryRequest,
  ): Promise<EmailDeliveryResult> {
    let response: Response;

    try {
      response = await this.fetchImplementation(this.apiUrl, {
        body: JSON.stringify({
          from: email.from,
          html: email.html,
          subject: email.subject,
          text: email.text,
          to: [email.to],
        }),
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': email.idempotencyKey,
        },
        method: 'POST',
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (error: unknown) {
      const code =
        error instanceof Error &&
        (error.name === 'AbortError' || error.name === 'TimeoutError')
          ? 'EMAIL_PROVIDER_TIMEOUT'
          : 'EMAIL_PROVIDER_UNAVAILABLE';
      throw new EmailDeliveryError(code, true);
    }

    const body = await this.readJson(response);

    if (!response.ok) {
      throw this.translateError(response.status, body);
    }

    const messageId = this.readMessageId(body);

    if (messageId === undefined) {
      throw new EmailDeliveryError('EMAIL_PROVIDER_INVALID_RESPONSE', true);
    }

    return { messageId };
  }

  private readMessageId(body: unknown): string | undefined {
    if (typeof body !== 'object' || body === null) {
      return undefined;
    }

    const { id } = body as ResendSuccessBody;
    return typeof id === 'string' && id.length > 0 && id.length <= 256
      ? id
      : undefined;
  }

  private async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return undefined;
    }
  }

  private translateError(status: number, body: unknown): EmailDeliveryError {
    const providerCode = this.readProviderCode(body);

    if (status === 409 && providerCode === 'concurrent_idempotent_requests') {
      return new EmailDeliveryError(
        'EMAIL_PROVIDER_IDEMPOTENCY_CONCURRENT',
        true,
      );
    }

    if (status === 409 && providerCode === 'invalid_idempotent_request') {
      return new EmailDeliveryError(
        'EMAIL_PROVIDER_IDEMPOTENCY_CONFLICT',
        false,
      );
    }

    if (status === 408) {
      return new EmailDeliveryError('EMAIL_PROVIDER_TIMEOUT', true);
    }

    if (status === 429) {
      return new EmailDeliveryError('EMAIL_PROVIDER_RATE_LIMITED', true);
    }

    if (status >= 500) {
      return new EmailDeliveryError('EMAIL_PROVIDER_UNAVAILABLE', true);
    }

    return new EmailDeliveryError('EMAIL_PROVIDER_REQUEST_REJECTED', false);
  }

  private readProviderCode(body: unknown): string | undefined {
    if (typeof body !== 'object' || body === null) {
      return undefined;
    }

    const { name } = body as ResendErrorBody;
    return typeof name === 'string' ? name : undefined;
  }
}
