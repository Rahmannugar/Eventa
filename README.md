# Eventa

A distributed event ticketing platform built on a NestJS microservices architecture using gRPC, Kafka, RabbitMQ, PostgreSQL, Redis, OpenTelemetry, and Docker Compose.

https://excalidraw.com/#json=SFbQZx5HysD4qID-yI_WI,BiqyfjSj0iGFfR4oRcvJ_A

## Overview

Eventa is a distributed event ticketing platform that enables organizers to create and manage events, publish tickets, process attendee purchases through Stripe, validate QR code check-ins, issue refunds for cancelled events, deliver personalized event recommendations using pgvector embeddings, and provide analytics for organizers.

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