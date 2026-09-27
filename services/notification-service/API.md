# API

Notification Service exposes only its operational HTTP surface. Business work arrives as messages, not as requests.

## Endpoints

### `GET /health/live`

Process liveness. Always `200 {"status":"ok"}`; it checks no dependency.

### `GET /health/ready`

Instance readiness. Returns `200 {"status":"ready"}` when every readiness dependency responds, otherwise:

```json
{ "statusCode": 503, "message": "dependency unavailable", "error": "Service Unavailable" }
```

Readiness aggregates only dependencies the process actually holds: a ping on its own database pool and the state of its own broker connection. It never reports a state that nothing observes, and it never probes the broker, Resend, Identity, Event, Kafka, or the OTLP collector.

Any other method on either path returns `405`.

## Ports

`HEALTH_PORT` (local default `3006`).

## Not exposed

There is no public business endpoint. Attendees reach notification outcomes through email; operators reach state through the database, logs, metrics, and traces.
