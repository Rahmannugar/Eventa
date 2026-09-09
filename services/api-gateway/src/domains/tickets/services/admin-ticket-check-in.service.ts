import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiHttpException } from '../../../http/errors/api-http.exception';
import type { AdminTicketCheckInDto, AdminTicketCheckInResponseDto } from '../dto/admin-ticket-check-in.dto';

@Injectable()
export class AdminTicketCheckInService {
  constructor(private readonly baseUrl: string, private readonly deadlineMs: number) {}

  async checkIn(eventId: string, qrToken: string, adminId: string, requestId: string): Promise<AdminTicketCheckInResponseDto> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.deadlineMs);
    try {
      const response = await fetch(new URL('/v1/tickets/check-in', this.baseUrl), {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json', 'x-request-id': requestId },
        body: JSON.stringify({ eventId, qrToken, checkedInBy: adminId } satisfies AdminTicketCheckInDto & { eventId: string; checkedInBy: string }),
      });
      if (response.status === 400) throw new ApiHttpException(HttpStatus.BAD_REQUEST, 'TICKET_CHECK_IN_INVALID', 'That ticket could not be checked in.');
      if (response.status === 409) throw new ApiHttpException(HttpStatus.CONFLICT, 'TICKET_ALREADY_REVOKED', 'That ticket cannot be checked in.');
      if (!response.ok) throw this.unavailable();
      const body: unknown = await response.json();
      if (!isResponse(body)) throw this.unavailable();
      return body;
    } catch (error: unknown) {
      if (error instanceof ApiHttpException) throw error;
      throw this.unavailable();
    } finally { clearTimeout(timer); }
  }

  private unavailable(): ApiHttpException { return new ApiHttpException(HttpStatus.SERVICE_UNAVAILABLE, 'TICKET_SERVICE_UNAVAILABLE', 'Ticket check-in is temporarily unavailable.'); }
}

function isResponse(value: unknown): value is AdminTicketCheckInResponseDto {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.ticketId === 'string' && typeof candidate.eventId === 'string' && typeof candidate.checkedInAt === 'string' && typeof candidate.alreadyCheckedIn === 'boolean';
}
