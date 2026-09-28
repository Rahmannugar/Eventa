# API

Discovery Service exposes only its operational HTTP surface. Business work arrives as messages, not as requests.

## Endpoints

### `GET /health/live`

Process liveness. Always `200 {"status":"ok"}`; it checks no dependency.

### `GET /health/ready`

Instance readiness. Returns `200 {"status":"ready"}` when every readiness dependency responds, otherwise:

```json
{
  "statusCode": 503,
  "message": "dependency unavailable",
  "error": "Service Unavailable"
}
```

Readiness aggregates only the dependency this process holds as shared state: a ping on its own database pool. The lifecycle consumer rejoins its group and retries through its own backoff when the broker is unreachable, and Event Service is dialled per call with an explicit deadline, so neither is a reason to report an instance unready. Readiness never probes Kafka, Event Service, or the OTLP collector.

Any other method on either path returns `405`.

Every response carries `x-request-id`. An inbound `x-request-id` is echoed when it matches `[A-Za-z0-9._:-]{1,128}`; anything else is replaced with a generated UUID.

## Ports

`HEALTH_PORT` (local default `3011`).

## Not exposed

There is no public business endpoint. Search and recommendation are reached through the API Gateway routes introduced with those slices; until then, state is read through the database, logs, metrics, and traces.
