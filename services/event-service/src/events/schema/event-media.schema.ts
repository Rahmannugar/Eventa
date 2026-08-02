import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import {
  eventMediaUploads,
  type EventMediaSlot,
} from './event-media-upload.schema';
import { events } from './event.schema';

export const eventMedia = pgTable(
  'event_media',
  {
    id: uuid('id')
      .primaryKey()
      .references(() => eventMediaUploads.id, { onDelete: 'restrict' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    slot: text('slot').$type<EventMediaSlot>().notNull(),
    objectKey: text('object_key').notNull(),
    contentType: text('content_type')
      .$type<'image/jpeg' | 'image/png' | 'image/webp'>()
      .notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    etag: text('etag').notNull(),
    attachedAt: timestamp('attached_at', {
      mode: 'date',
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('event_media_event_slot_unique').on(table.eventId, table.slot),
    uniqueIndex('event_media_object_key_unique').on(table.objectKey),
    check(
      'event_media_slot_allowed',
      sql`${table.slot} IN ('cover', 'gallery_1', 'gallery_2', 'gallery_3', 'gallery_4')`,
    ),
    check(
      'event_media_content_type_allowed',
      sql`${table.contentType} IN ('image/jpeg', 'image/png', 'image/webp')`,
    ),
    check(
      'event_media_size_allowed',
      sql`${table.sizeBytes} BETWEEN 1 AND 8388608`,
    ),
    check('event_media_width_positive', sql`${table.width} >= 1`),
    check('event_media_height_positive', sql`${table.height} >= 1`),
  ],
);
