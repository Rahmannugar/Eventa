import { recordBusinessOutcome } from '@eventa/observability';
import { Injectable, Logger } from '@nestjs/common';

import { EVENT_CANCELLATION_EMAIL_OPERATION } from '../constants/cancellation-email.constants';
import { CancellationEmailRepository } from '../repositories/cancellation-email.repository';
import type {
  CancellationEmailIngestOutcome,
  TicketRevokedFact,
} from '../types/cancellation-email.types';

@Injectable()
export class CancellationEmailIngestService {
  private readonly logger = new Logger(CancellationEmailIngestService.name);

  constructor(private readonly repository: CancellationEmailRepository) {}

  async handleRevocation(
    fact: TicketRevokedFact,
  ): Promise<CancellationEmailIngestOutcome> {
    const record = await this.repository.recordRevocation(fact);
    const outcome: CancellationEmailIngestOutcome =
      record.kind === 'created' ? 'processed' : record.kind;

    const fields = {
      event_id: fact.eventId,
      message_id: fact.messageId,
      operation: EVENT_CANCELLATION_EMAIL_OPERATION,
    };

    if (record.kind === 'created') {
      this.logger.log({
        ...fields,
        delivery_id: record.deliveryId,
        event: 'event_cancellation_email_job_created',
        outcome,
      });
    } else {
      this.logger.log({
        ...fields,
        event:
          record.kind === 'grouped'
            ? 'event_cancellation_email_grouped'
            : 'event_cancellation_email_duplicate',
        outcome,
      });
    }

    recordBusinessOutcome({
      operation: EVENT_CANCELLATION_EMAIL_OPERATION,
      outcome,
    });
    return outcome;
  }
}
