import { describe, expect, it } from 'vitest';

import { missingEventPublicationRequirements } from '../../src/lib/events/event-publication';
import type { AdminEvent } from '../../src/lib/events/event.types';

function completeEvent(): AdminEvent {
  return {
    categories: ['Music'],
    createdAt: '2026-08-16T12:00:00.000Z',
    createdByAdminId: '4185b190-143e-42cd-aac7-3ea05996c9b6',
    description: 'An evening of live music.',
    endsAt: '2026-10-15T21:00:00.000Z',
    eventId: '148fc84b-640a-4f62-9248-46b04e8b68fe',
    media: [
      {
        contentType: 'image/jpeg',
        height: 900,
        mediaId: '07769044-d273-450b-9569-06b84d1a6ed5',
        sizeBytes: 120_000,
        slot: 'cover',
        url: 'https://images.example.test/cover.jpg',
        width: 1_600,
      },
    ],
    startsAt: '2026-10-15T18:00:00.000Z',
    status: 'draft',
    timeZone: 'Africa/Lagos',
    title: 'Live at the Marina',
    updatedAt: '2026-08-16T12:00:00.000Z',
    venue: {
      addressLine1: '1 Marina Road',
      city: 'Lagos',
      countryCode: 'NG',
      name: 'Eventa Hall',
    },
    version: 3,
  };
}

describe('event publication readiness', () => {
  it('accepts a complete event with a verified cover', () => {
    expect(missingEventPublicationRequirements(completeEvent())).toEqual([]);
  });

  it('identifies every missing publication requirement', () => {
    expect(
      missingEventPublicationRequirements({
        ...completeEvent(),
        categories: [],
        description: undefined,
        endsAt: undefined,
        media: [],
        startsAt: undefined,
        timeZone: undefined,
        venue: undefined,
      }),
    ).toEqual(['description', 'categories', 'schedule', 'venue', 'cover']);
  });
});
