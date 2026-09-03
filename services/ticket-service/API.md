# Ticket Service API

The service exposes `GET /health/live` for process liveness and `GET /health/ready` only while PostgreSQL is reachable. Business HTTP and Gateway contracts are added with the ticket retrieval slice.
