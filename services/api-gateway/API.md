# API Gateway API

## Business Domains

| Domain    | Public surface                     | Documentation                                 |
| --------- | ---------------------------------- | --------------------------------------------- |
| Attendees | `/auth/attendees/*` HTTP endpoints | [Attendees API](src/domains/attendees/API.md) |

The generated OpenAPI document is authoritative for exact public HTTP schemas. Domain API files explain behavior, errors, and transport policy without duplicating that contract.

## Public Error Envelope

Business endpoints use one public shape:

```json
{
  "statusCode": 422,
  "code": "VALIDATION_FAILED",
  "message": "Check the highlighted fields and try again.",
  "errors": [
    {
      "field": "password",
      "code": "TOO_SHORT",
      "message": "Password must be at least 12 characters."
    }
  ]
}
```

`errors` is present only when the client can correct specific fields. Internal dependency names and error details are never exposed. Every response includes an `x-request-id`; a valid incoming value is preserved, otherwise the Gateway creates one and forwards it on internal calls.

## Operational and Documentation Routes

| Method | Path            | Purpose                                |
| ------ | --------------- | -------------------------------------- |
| `GET`  | `/health/live`  | Confirms the Gateway process is alive. |
| `GET`  | `/docs`         | Scalar interactive API reference.      |
| `GET`  | `/openapi.json` | Importable OpenAPI JSON contract.      |
| `GET`  | `/openapi.yaml` | Importable OpenAPI YAML contract.      |
