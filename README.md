# Eventa

A distributed event ticketing platform built on a NestJS microservices architecture using gRPC, Kafka, RabbitMQ, PostgreSQL, Redis, OpenTelemetry, and Docker Compose.

https://excalidraw.com/#json=SFbQZx5HysD4qID-yI_WI,BiqyfjSj0iGFfR4oRcvJ_A

## Overview

Eventa is a distributed event ticketing platform that enables organizers to create and manage events, publish tickets, process attendee purchases through Stripe, validate QR code check-ins, issue refunds for cancelled events, deliver semantic and location-aware recommendations using Ahnlich, Gemini, and PostGIS, and provide analytics for organizers.

The system is composed of independently deployable services responsible for identity, events, ticketing, orders, payments, discovery, analytics, notifications, and an API Gateway. Services communicate using HTTP, gRPC, Kafka, and RabbitMQ, combining synchronous request-response communication with asynchronous event-driven workflows.

The project is designed to explore production engineering practices including distributed transactions, compensating actions, event-driven architecture, observability, background processing, and clear service ownership while remaining fully runnable locally using Docker Compose.

## Architecture

- API Gateway
- Identity Service
- Event Service
- Order Service
- Ticket Service
- Payment Service
- Discovery Service
- Analytics Service
- Notification Service

## Technology

### Backend

- NestJS
- TypeScript
- PostgreSQL
- Redis
- Kafka
- RabbitMQ
- gRPC
- Stripe
- Resend
- Ahnlich(Vector DB + AI proxy)

### AI

- Google Gemini

### Observability

- OpenTelemetry
- Prometheus
- Grafana
- Loki
- Tempo

### Frontend

- React
- Vite

### Infrastructure

- Docker Compose

## Local Development

The current Compose stack starts the API Gateway, Identity Service, its PostgreSQL database, the Redis-backed registration rate-limit store, and a one-shot Identity migration container.

Start the stack with:

```bash
pnpm services:start
```

The command creates missing ignored service environment files automatically and does not overwrite existing files.

The migration must complete successfully before Identity starts, and the Gateway waits for healthy Identity and Redis containers.

Current local endpoints:

- API Gateway: `http://localhost:3004`
- Scalar API reference: `http://localhost:3004/docs`
- OpenAPI JSON: `http://localhost:3004/openapi.json`
- OpenAPI YAML: `http://localhost:3004/openapi.yaml`
- Gateway liveness: `http://localhost:3004/health/live`
- Identity readiness: `http://localhost:3005/health/ready`

Stop the stack without deleting database data:

```bash
pnpm services:stop
```

Use `pnpm db:reset:all` only when you intentionally want to delete and recreate all local databases.
