import { TICKET_REVOKED_EVENT_TYPE } from '@eventa/messaging-contracts/ticket/ticket-lifecycle.events';

import type { ParsedTicketRevokedFact } from '../../types/cancellation-email.types';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseTicketRevokedFact(
  value: Buffer | null,
): ParsedTicketRevokedFact {
  if (value === null) return { kind: 'rejected' };

  let payload: unknown;
  try {
    payload = JSON.parse(value.toString('utf8'));
  } catch {
    return { kind: 'rejected' };
  }

  if (typeof payload !== 'object' || payload === null)
    return { kind: 'rejected' };

  const record = payload as Record<string, unknown>;
  const type = record.type;
  if (typeof type !== 'string') return { kind: 'rejected' };
  if (type !== TICKET_REVOKED_EVENT_TYPE) return { kind: 'foreign', type };

  const { attendeeId, eventId, messageId, ticketId, revokedAt } = record;
  if (
    typeof attendeeId !== 'string' ||
    !UUID_PATTERN.test(attendeeId) ||
    typeof eventId !== 'string' ||
    !UUID_PATTERN.test(eventId) ||
    typeof messageId !== 'string' ||
    !UUID_PATTERN.test(messageId) ||
    typeof ticketId !== 'string' ||
    !UUID_PATTERN.test(ticketId) ||
    typeof revokedAt !== 'string' ||
    revokedAt === ''
  ) {
    return { kind: 'rejected' };
  }

  return {
    kind: 'accepted',
    fact: {
      attendeeId,
      eventId,
      messageId,
      revokedAt,
      ticketId,
      type: TICKET_REVOKED_EVENT_TYPE,
    },
  };
}
