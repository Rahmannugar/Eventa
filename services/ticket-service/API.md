# Ticket Service API

The service exposes `GET /health/live` for process liveness and `GET /health/ready` only while PostgreSQL is reachable. Business HTTP and Gateway contracts are added with the ticket retrieval slice.

`GET /v1/attendees/:attendeeId/tickets` returns the attendee's issued tickets with opaque QR credentials. `limit` is bounded to 100 and `before` is an opaque cursor containing the ordered timestamp and ticket ID. The API is an internal service boundary; the API Gateway owns the public session and authorization boundary.
