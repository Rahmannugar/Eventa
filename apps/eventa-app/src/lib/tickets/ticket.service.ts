import { z } from 'zod';

import { apiRequest } from '../api/api-client';
import type { AttendeeTicketPage } from './ticket.types';

const ticketSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  eventId: z.string().uuid(),
  ticketTypeId: z.string().uuid(),
  unitIndex: z.number().int().nonnegative(),
  status: z.enum(['issued', 'checked_in', 'revoked']),
  issuedAt: z.string(),
  qrToken: z.string().min(1),
});

const ticketPageSchema = z.object({
  tickets: z.array(ticketSchema),
  nextBefore: z.string(),
});

export function listAttendeeTickets(
  before: string | undefined,
  signal?: AbortSignal,
): Promise<AttendeeTicketPage> {
  const params = new URLSearchParams({ limit: '12' });
  if (before !== undefined) params.set('before', before);

  return apiRequest(`/tickets?${params.toString()}`, {
    responseSchema: ticketPageSchema,
    ...(signal === undefined ? {} : { signal }),
  });
}
