import { describe, expect, it } from 'vitest';

import {
  emptyEventFormValues,
  validateCreateEventForm,
  type DraftEventFormValues,
} from '../../src/lib/events/event.validation';

function completeForm(): DraftEventFormValues {
  return {
    ...emptyEventFormValues(),
    addressLine1: '1 Marina Road',
    categories: ['Outdoors', 'Sports'],
    city: 'Lagos',
    countryCode: 'NG',
    description: 'An outdoor community sports event.',
    endsAt: '2026-10-15T18:00',
    startsAt: '2026-10-15T09:00',
    timeZone: 'Africa/Lagos',
    title: 'Community sports day',
    venueName: 'Eventa Hall',
  };
}

describe('event creation validation', () => {
  it('preserves multiple categories and converts local schedule instants', () => {
    const result = validateCreateEventForm(completeForm());

    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({
        categories: ['Outdoors', 'Sports'],
        endsAt: '2026-10-15T17:00:00.000Z',
        startsAt: '2026-10-15T08:00:00.000Z',
      }),
    });
  });

  it('rejects more than five categories', () => {
    const result = validateCreateEventForm({
      ...completeForm(),
      categories: ['One', 'Two', 'Three', 'Four', 'Five', 'Six'],
    });

    expect(result).toEqual({
      success: false,
      errors: expect.objectContaining({
        categories: 'Choose no more than five categories.',
      }),
    });
  });

  it('rejects an end time that does not follow the start', () => {
    const result = validateCreateEventForm({
      ...completeForm(),
      endsAt: '2026-10-15T08:00',
    });

    expect(result).toEqual({
      success: false,
      errors: expect.objectContaining({
        endsAt: 'End time must be after the start time.',
      }),
    });
  });
});
