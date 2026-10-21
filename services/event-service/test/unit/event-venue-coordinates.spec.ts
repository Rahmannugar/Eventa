import { describe, expect, it, vi } from 'vitest';

import { EventVenueInvalidError } from '../../src/events/errors/event.errors';
import { EventManagementService } from '../../src/events/services/event-management.service';
import type {
  CreateDraftEventCommand,
  EventRecord,
  EventRepository,
} from '../../src/events/types/event.types';

const command = (
  venue: Partial<CreateDraftEventCommand['venue']>,
): CreateDraftEventCommand => ({
  actorAdminId: '00000000-0000-4000-8000-000000000001',
  requestId: '00000000-0000-4000-8000-000000000002',
  title: 'Lagos Design Week',
  description: 'A week of design.',
  categories: ['design'],
  startsAt: '2026-11-01T09:00:00+01:00',
  endsAt: '2026-11-07T18:00:00+01:00',
  timeZone: 'Africa/Lagos',
  venue: {
    name: 'Landmark Centre',
    addressLine1: 'Water Corporation Drive',
    city: 'Lagos',
    countryCode: 'NG',
    ...venue,
  },
});

describe('EventManagementService venue coordinates', () => {
  it('stores a venue with paired coordinates', async () => {
    const createDraft = vi
      .fn<EventRepository['createDraft']>()
      .mockResolvedValue({} as EventRecord);
    const service = new EventManagementService({ createDraft } as never);

    await service.createDraft(command({ latitude: 6.5244, longitude: 3.3792 }));

    const saved = createDraft.mock.calls[0]?.[0];
    expect(saved?.venue.latitude).toBe(6.5244);
    expect(saved?.venue.longitude).toBe(3.3792);
  });

  it('stores null coordinates when none are supplied', async () => {
    const createDraft = vi
      .fn<EventRepository['createDraft']>()
      .mockResolvedValue({} as EventRecord);
    const service = new EventManagementService({ createDraft } as never);

    await service.createDraft(command({}));

    const saved = createDraft.mock.calls[0]?.[0];
    expect(saved?.venue.latitude).toBeNull();
    expect(saved?.venue.longitude).toBeNull();
  });

  it('rejects a venue with only one coordinate', async () => {
    const service = new EventManagementService({} as never);

    await expect(
      service.createDraft(command({ latitude: 6.5244 })),
    ).rejects.toThrow(EventVenueInvalidError);
    await expect(
      service.createDraft(command({ longitude: 3.3792 })),
    ).rejects.toThrow(EventVenueInvalidError);
  });

  it('rejects coordinates outside valid ranges', async () => {
    const service = new EventManagementService({} as never);

    await expect(
      service.createDraft(command({ latitude: 91, longitude: 3.3792 })),
    ).rejects.toThrow(EventVenueInvalidError);
    await expect(
      service.createDraft(command({ latitude: 6.5244, longitude: 181 })),
    ).rejects.toThrow(EventVenueInvalidError);
  });
});
