import { sql } from 'drizzle-orm';
import { check, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { events } from './event.schema';

export const eventVenues = pgTable(
  'event_venues',
  {
    eventId: uuid('event_id')
      .primaryKey()
      .references(() => events.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    addressLine1: text('address_line_1').notNull(),
    addressLine2: text('address_line_2'),
    city: text('city').notNull(),
    region: text('region'),
    postalCode: text('postal_code'),
    countryCode: text('country_code').notNull(),
  },
  (table) => [
    check(
      'event_venues_name_normalized',
      sql`${table.name} = btrim(${table.name})`,
    ),
    check(
      'event_venues_name_length',
      sql`char_length(${table.name}) BETWEEN 1 AND 160`,
    ),
    check(
      'event_venues_address_line_1_normalized',
      sql`${table.addressLine1} = btrim(${table.addressLine1})`,
    ),
    check(
      'event_venues_address_line_1_length',
      sql`char_length(${table.addressLine1}) BETWEEN 1 AND 200`,
    ),
    check(
      'event_venues_address_line_2_length',
      sql`${table.addressLine2} IS NULL OR char_length(${table.addressLine2}) BETWEEN 1 AND 200`,
    ),
    check(
      'event_venues_address_line_2_normalized',
      sql`${table.addressLine2} IS NULL OR ${table.addressLine2} = btrim(${table.addressLine2})`,
    ),
    check(
      'event_venues_city_normalized',
      sql`${table.city} = btrim(${table.city})`,
    ),
    check(
      'event_venues_city_length',
      sql`char_length(${table.city}) BETWEEN 1 AND 120`,
    ),
    check(
      'event_venues_region_length',
      sql`${table.region} IS NULL OR char_length(${table.region}) BETWEEN 1 AND 120`,
    ),
    check(
      'event_venues_region_normalized',
      sql`${table.region} IS NULL OR ${table.region} = btrim(${table.region})`,
    ),
    check(
      'event_venues_postal_code_length',
      sql`${table.postalCode} IS NULL OR char_length(${table.postalCode}) BETWEEN 1 AND 32`,
    ),
    check(
      'event_venues_postal_code_normalized',
      sql`${table.postalCode} IS NULL OR ${table.postalCode} = btrim(${table.postalCode})`,
    ),
    check(
      'event_venues_country_code',
      sql`${table.countryCode} ~ '^[A-Z]{2}$'`,
    ),
  ],
);
