import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiHttpException } from '../../../http/errors/api-http.exception';
import type { AttendeeTicketsDto } from '../dto/attendee-tickets.dto';

@Injectable()
export class AttendeeTicketsService {
  constructor(private readonly baseUrl: string, private readonly deadlineMs: number) {}

  async list(attendeeId: string, query: { limit?: number; before?: string }, requestId: string): Promise<AttendeeTicketsDto> {
    const url = new URL(`/v1/attendees/${encodeURIComponent(attendeeId)}/tickets`, this.baseUrl);
    if (query.limit !== undefined) url.searchParams.set('limit', String(query.limit));
    if (query.before !== undefined) url.searchParams.set('before', query.before);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.deadlineMs);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { 'x-request-id': requestId } });
      if (!response.ok) throw this.unavailable();
      const body: unknown = await response.json();
      if (!isTicketResponse(body)) throw this.unavailable();
      return body;
    } catch (error: unknown) {
      if (error instanceof ApiHttpException) throw error;
      throw this.unavailable();
    } finally { clearTimeout(timer); }
  }

  private unavailable(): ApiHttpException {
    return new ApiHttpException(HttpStatus.SERVICE_UNAVAILABLE, 'TICKET_SERVICE_UNAVAILABLE', 'Tickets are temporarily unavailable. Try again later.');
  }
}

function isTicketResponse(value: unknown): value is AttendeeTicketsDto {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { tickets?: unknown; nextBefore?: unknown };
  return Array.isArray(candidate.tickets) && typeof candidate.nextBefore === 'string';
}
