import { randomUUID } from 'node:crypto';

import { TICKET_REVOKED_EVENT_TYPE } from '@eventa/messaging-contracts/ticket/ticket-lifecycle.events';
import { describe, expect, it } from 'vitest';

import { parseTicketRevokedFact } from '../../src/notifications/job-queue/cancellation/ticket-revocation-fact';

const fact = {
  attendeeId: randomUUID(),
  eventId: randomUUID(),
  messageId: randomUUID(),
  revokedAt: '2026-09-25T10:00:00.000Z',
  ticketId: randomUUID(),
  type: TICKET_REVOKED_EVENT_TYPE,
};

function value(payload: unknown): Buffer {
  return Buffer.from(JSON.stringify(payload), 'utf8');
}

describe('parseTicketRevokedFact', () => {
  it('accepts the committed revocation payload', () => {
    expect(parseTicketRevokedFact(value(fact))).toEqual({
      kind: 'accepted',
      fact,
    });
  });

  it('ignores a fact published for another lifecycle type', () => {
    expect(
      parseTicketRevokedFact(value({ ...fact, type: 'ticket.checked-in.v1' })),
    ).toEqual({ kind: 'foreign', type: 'ticket.checked-in.v1' });
  });

  it('rejects a payload without a type', () => {
    expect(
      parseTicketRevokedFact(
        value({
          eventId: fact.eventId,
          messageId: fact.messageId,
        }),
      ),
    ).toEqual({ kind: 'rejected' });
  });

  it.each([
    ['a missing attendee', { ...fact, attendeeId: undefined }],
    ['a non-uuid attendee', { ...fact, attendeeId: 'attendee-1' }],
    ['a missing event', { ...fact, eventId: undefined }],
    ['a missing message', { ...fact, messageId: undefined }],
    ['a missing ticket', { ...fact, ticketId: undefined }],
    ['a missing revocation time', { ...fact, revokedAt: '' }],
  ])('rejects %s', (_, payload) => {
    expect(parseTicketRevokedFact(value(payload))).toEqual({
      kind: 'rejected',
    });
  });

  it('rejects malformed bytes', () => {
    expect(parseTicketRevokedFact(Buffer.from('{not json', 'utf8'))).toEqual({
      kind: 'rejected',
    });
  });

  it('rejects an empty message', () => {
    expect(parseTicketRevokedFact(null)).toEqual({ kind: 'rejected' });
  });
});
