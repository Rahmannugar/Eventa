# Notification Service API

## Business Domains

| Domain        | Internal surface                                              | Documentation                                 |
| ------------- | ------------------------------------------------------------- | --------------------------------------------- |
| Notifications | `AttendeeEmailVerificationJob` RabbitMQ consumer, version `1` | [Notifications API](src/notifications/API.md) |

We expose no client-facing business HTTP routes and no gRPC service.

## Operational HTTP

| Method | Path            | Purpose                                                                                         |
| ------ | --------------- | ----------------------------------------------------------------------------------------------- |
| `GET`  | `/health/live`  | Confirms the Notification process is alive.                                                     |
| `GET`  | `/health/ready` | Confirms Notification PostgreSQL is queryable and the process-owned RabbitMQ connection exists. |
