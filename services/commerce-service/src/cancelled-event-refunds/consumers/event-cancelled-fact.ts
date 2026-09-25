import type { ParsedEventLifecycleFact } from '../types/cancelled-event-refund.types';

export const EVENT_CANCELLED_EVENT_TYPE = 'event.cancelled.v1';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseEventLifecycleFact(
  value: Buffer | null,
): ParsedEventLifecycleFact {
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
  if (type !== EVENT_CANCELLED_EVENT_TYPE) return { kind: 'foreign', type };
  const { messageId, eventId, cancelledAt } = record;
  if (
    typeof messageId !== 'string' ||
    !UUID_PATTERN.test(messageId) ||
    typeof eventId !== 'string' ||
    !UUID_PATTERN.test(eventId) ||
    typeof cancelledAt !== 'string' ||
    cancelledAt === ''
  ) {
    return { kind: 'rejected' };
  }
  return {
    kind: 'accepted',
    fact: { cancelledAt, eventId, messageId, type: EVENT_CANCELLED_EVENT_TYPE },
  };
}
