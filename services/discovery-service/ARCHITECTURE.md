# Architecture

Discovery Service is a frameworkless Go deployable. It composes explicit packages with the standard library plus pgx, tern, koanf, kafka-go, gRPC, and the OpenTelemetry SDK.

## Structure

- `cmd/discovery-service` — composition root. Loads and validates configuration, starts telemetry, opens the pool, dials Event, starts the lifecycle consumer, serves health and the query API, and shuts them down in the reverse order.
- `cmd/discovery-migration` — applies the reviewed SQL migrations in `migrations/` through tern, tracked in `discovery_schema_version`.
- `cmd/discovery-reindex` — rebuilds the semantic store from the projection. It is safe to run repeatedly and exits non-zero while anything remains unconverged.
- `internal/config` — one fixed validation order, so the first failing rule is the reported error.
- `internal/database` — pool construction, the migration runner, and the readiness adapter.
- `internal/index` — the lifecycle fact contract, the ingest transaction, the inbox claim, the index write, and the Kafka handler.
- `internal/lookup` — the narrow Event gRPC client used to resolve published content, with its own deadline.
- `internal/search` — the structured query: filter validation and bounds, the SQL over the projection, and the gRPC handler.
- `internal/semantic` — the derived semantic index: the capability port, the durable state rows, the one convergence path, and the reconciliation pass.
- `internal/semantic/ahnlich` — the Ahnlich AI adapter: connection, deadlines, model registry, and every vendor type.
- `internal/server` — the gRPC listener and its interceptors: trace continuation, request metrics and log line, and panic containment.
- `internal/gen` — generated protobuf and gRPC stubs, committed so the image build needs no protoc. `task proto` regenerates them from `packages/grpc-contracts`.
- `internal/messaging/kafka` — one group member over one topic: manual commits, restart backoff, and trace-header extraction.
- `internal/health` — liveness and readiness over a list of real dependency checkers, plus the request metrics and `http_request_completed` line that record a failed probe while a successful probe stays silent.
- `internal/logging` — the Eventa log envelope.
- `internal/metrics` — the job counter, duration histogram, in-flight gauge, and business outcome counter.
- `internal/telemetry` — OTLP trace and metric exporters, 10-second metric interval, the resource attributes naming the service, and W3C propagation over broker and gRPC headers.
- `internal/errtype` — the `error.type` value recorded on spans and logs.

## Lifecycle consumer

Event Service appends `event.published.v1` and `event.cancelled.v1` to its publication outbox in the same transaction as the publication state change, and its Debezium lane relays them to `eventa.event.lifecycle.v1` keyed by event id. We read the topic as one group member with manual commits.

We decide what a record means before we write anything. A fact of another type is acknowledged and skipped, so the shared topic never stalls on a consumer that does not own it. A record we cannot read is logged and left uncommitted, so the broker redelivers it until the producer that wrote it is corrected — the record is never silently dropped.

An accepted fact enters one transaction that claims the inbox, resolves the content Event Service owns, and writes the index row together:

- A **published** fact calls `GetPublishedEvent`. Content is copied from the response into the index row; Discovery derives none of it.
- A **cancelled** fact writes the status and cancellation time. It inserts a tombstone when Discovery never saw the publication, so an event it has never indexed is still known to be cancelled.

A replayed fact finds its inbox row and commits without a second resolve or a second write. Because Event Service writes at most one publication row per event against the outbox primary key `(event_id, event_type)`, a published fact has no message id of its own and the event id is its dedupe key; each cancellation carries its own message id and is claimed separately.

When Event Service no longer serves a published event — it was cancelled between publication and this consumer — the fact is still applied and the publication is recorded without content. Discovery never invents content it could not read, and the cancellation fact that follows writes the tombstone. A genuine resolve failure rolls the transaction back instead, so the claim is not recorded and the offset does not advance.

Outcomes are `processed`, `content_unavailable`, `duplicate`, `ignored`, and `rejected`, carried on `discovery.event_index` for every metric and log line on this path.

## Search API

`DiscoveryService.SearchEvents` answers from `discovery_event_index` alone: ordinary SQL over exact filters, no vector store, and no call to Event Service. Every request is validated before it reaches the database — page size and offset are bounded, timestamps must be RFC 3339, and a start bound after an end bound is rejected rather than silently widened. The page query and its count share one predicate, so `total` cannot disagree with the page.

Only `published` rows with content are eligible, so a cancellation removes an event from results the moment the fact lands, and a row whose content Event Service no longer served is never offered as an empty result.

Every RPC is traced, counted under `eventa.request.*` with `transport="grpc"`, and logged as `grpc_request_completed` with its request id and trace id. Readiness still covers only the database: an unavailable query API fails its calls without failing the instance.

## Semantic index

The semantic index is derived state. Event Service owns the event, Discovery owns the projection, and the vector store owns nothing: it can be dropped and rebuilt from `discovery_event_index`.

An accepted lifecycle fact records its semantic obligation in the same transaction that writes the projection row — `pending_index` with the content hash for a publication, `pending_removal` for a cancellation — so a committed fact and the obligation to embed it cannot separate. The push itself happens after the commit; a failure there leaves the row pending for the next pass instead of failing the fact.

`internal/semantic` holds the one convergence path. `Indexer.Sync` reads the projection and the recorded state together, pushes the rendered text when they disagree, and records `indexed` or `removed` only after the store accepts the change. An event that already matches costs one read and no store call, so the consumer, the reconciler, and the reindex command cannot embed an event differently from one another.

`Reconciler.Pass` runs on an interval and first repeats the idempotent store and predicate creation, because the service can start before the proxy finishes loading its model. It then does three bounded things: finishes anything still pending, probes what we claim to hold, and sends one synthetic query. The probe exists because Ahnlich persists an interval snapshot without a write-ahead log — a restart can drop entries while every call keeps succeeding, and only a read of the store catches it. The canary query makes a store that answers but returns nothing visible as `semantic_canary.*` instead of a quiet dashboard.

Every store query asks for cosine similarity, so a candidate score is a bounded 0-to-1 match rather than a distance. The proxy's default algorithm returns no score at all, so the adapter always names the algorithm instead of relying on it.

Metrics stay bounded: `eventa.semantic.operation.count` counts attempts by outcome (`indexed`, `removed`, `failed_<class>`), `eventa.semantic.canary.count` counts synthetic queries by result, and the `eventa.semantic.pending` gauge publishes how many events still disagree with the store. Every failure is stored as an `ErrorClass` label — never a message, a query, or an event payload.

Readiness does not cover Ahnlich. An unreachable store makes indexing fail loudly and the gauge rise while the instance stays ready, because the structured query it also serves reads only PostgreSQL.

## Data ownership

The service owns `discovery_event_inbox`, `discovery_event_index`, and `discovery_semantic_index` in its own PostgreSQL database. Migrations `0001_create_discovery_event_index.sql` and `0002_create_discovery_semantic_index.sql` create them.

Durable invariants:

- `discovery_event_inbox` is primary-keyed on `(event_type, message_id)`, so a replayed fact cannot be recorded twice.
- `discovery_event_index` is primary-keyed on `event_id`, so one event has exactly one projection row.
- `discovery_event_index.status` is constrained to `published` or `cancelled`.
- `version` and the content columns are nullable: a tombstone for an event never indexed carries no version, and a publication Event no longer serves carries no content.
- `discovery_semantic_index` is primary-keyed on `event_id`, so one event records exactly one store state.
- `discovery_semantic_index.status` is constrained to `pending_index`, `indexed`, `pending_removal`, or `removed`, and an indexed row must carry the content hash it was pushed with.
- The projection is a copy for retrieval and rebuild. It never answers whether an event is on sale, available, or near the attendee; those come from Event Service.

## Dependencies

- PostgreSQL — own schema only
- Kafka — the shared event lifecycle topic, group-scoped, manual commits
- Event Service over internal gRPC, with an explicit deadline
- The API Gateway calls this service over internal gRPC, with its own deadline
- Ahnlich AI proxy over internal gRPC, with its own deadline, for the derived semantic index
- OTLP collector — traces and metrics

Readiness covers only the database. Kafka group membership recovers through the consumer's own restart backoff, Event Service is dialled per call, and Ahnlich is a derived-state dependency that reports through the pending gauge and the canary, so none is a reason to report an instance unready; telemetry availability never gates startup or readiness.

## Shutdown

SIGTERM or SIGINT stops the HTTP health server, gracefully stops the query API, cancels the reconciler, leaves the Kafka group, closes the Event gRPC connection and the semantic store connection, drains the pool, then flushes traces and the final metric batch. In-flight messages are left unacknowledged so the broker redelivers them rather than losing them.
