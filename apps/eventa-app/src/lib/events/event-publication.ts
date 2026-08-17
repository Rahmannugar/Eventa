import type { AdminEvent } from './event.types';

export type EventPublicationRequirement =
  | 'categories'
  | 'cover'
  | 'description'
  | 'schedule'
  | 'tickets'
  | 'venue';

export function missingEventPublicationRequirements(
  event: AdminEvent,
  hasTicketType: boolean,
): EventPublicationRequirement[] {
  const missing: EventPublicationRequirement[] = [];

  if (event.description === undefined) missing.push('description');
  if (event.categories.length === 0) missing.push('categories');
  if (
    event.startsAt === undefined ||
    event.endsAt === undefined ||
    event.timeZone === undefined
  ) {
    missing.push('schedule');
  }
  if (event.venue === undefined) missing.push('venue');
  if (!event.media.some((media) => media.slot === 'cover')) missing.push('cover');
  if (!hasTicketType) missing.push('tickets');

  return missing;
}
