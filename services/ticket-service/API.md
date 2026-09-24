# Ticket Service API

The service exposes `GET /health/live` for process liveness and `GET /health/ready` only while PostgreSQL is reachable. Business HTTP and Gateway contracts are added with the ticket retrieval slice.

`GET /v1/attendees/:attendeeId/tickets` returns the attendee's issued tickets with opaque QR credentials. `limit` is bounded to 100 and `before` is an opaque cursor containing the ordered timestamp and ticket ID. The API is an internal service boundary; the API Gateway owns the public session and authorization boundary.

`POST /v1/tickets/check-in` validates a QR credential for the supplied event and records one check-in. Repeating the same valid scan returns the original check-in without creating another transition. Revoked tickets cannot be checked in.

Ticket Service consumes `event.cancelled.v1` on the internal Event lifecycle topic and skips other lifecycle facts on that shared topic. It revokes every non-revoked ticket for the cancelled event exactly once and appends one immutable `ticket.revoked.v1` outbox fact per ticket. The Ticket-owned Debezium lane publishes those facts to Kafka.
