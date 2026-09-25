import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { parseEventLifecycleFact } from '../../src/cancelled-event-refunds/consumers/event-cancelled-fact';

function payload(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value), 'utf8');
}

function fact(overrides: Record<string, unknown> = {}) {
  return {
    cancelledAt: '2026-09-25T10:00:00.000Z',
    eventId: randomUUID(),
    messageId: randomUUID(),
    type: 'event.cancelled.v1',
    ...overrides,
  };
}

describe('parseEventLifecycleFact', () => {
  it('accepts a well formed event cancellation fact', () => {
    const value = fact();
    const parsed = parseEventLifecycleFact(payload(value));

    expect(parsed).toEqual({ fact: value, kind: 'accepted' });
  });

  it('skips a fact type this consumer does not own', () => {
    const parsed = parseEventLifecycleFact(
      payload({ ...fact(), type: 'event.published.v1' }),
    );

    expect(parsed).toEqual({ kind: 'foreign', type: 'event.published.v1' });
  });

  it('rejects a cancellation fact with an invalid message id', () => {
    const parsed = parseEventLifecycleFact(
      payload(fact({ messageId: 'nope' })),
    );

    expect(parsed).toEqual({ kind: 'rejected' });
  });

  it('rejects a cancellation fact without an event id', () => {
    const parsed = parseEventLifecycleFact(
      payload({ ...fact(), eventId: undefined }),
    );

    expect(parsed).toEqual({ kind: 'rejected' });
  });

  it('rejects a payload that is not a fact object', () => {
    expect(parseEventLifecycleFact(payload('event.cancelled.v1'))).toEqual({
      kind: 'rejected',
    });
    expect(parseEventLifecycleFact(null)).toEqual({ kind: 'rejected' });
    expect(parseEventLifecycleFact(Buffer.from('{"type":', 'utf8'))).toEqual({
      kind: 'rejected',
    });
  });
});
