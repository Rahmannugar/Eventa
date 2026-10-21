# Architecture

Discovery Service is a frameworkless Go deployable. It composes explicit packages with the standard library plus pgx, tern, koanf, kafka-go, gRPC, and the OpenTelemetry SDK.

## Structure

- `cmd/discovery-service` — composition root. Loads and validates configuration, starts telemetry, opens the pool, dials Event, starts the lifecycle and behaviour consumers, serves health and the query API, and shuts them down in the reverse order.
- `cmd/discovery-migration` — applies the reviewed SQL migrations in `migrations/` through tern, tracked in `discovery_schema_version`.
- `cmd/discovery-reindex` — rebuilds the semantic store from the projection. It is safe to run repeatedly and exits non-zero while anything remains unconverged.
- `internal/config` — one fixed validation order, so the first failing rule is the reported error.
- `internal/database` — pool construction, the migration runner, and the readiness adapter.
- `internal/index` — the lifecycle fact contract, the ingest transaction, the inbox claim, the index write, and the Kafka handler.
- `internal/behaviour` — the attendee behaviour evidence: fact parsing for the commerce and check-in topics, the inbox claim and evidence upsert in one transaction, and the bounded evidence read the recommendation rendering consumes.
- `internal/lookup` — the narrow Event gRPC client used to resolve published content, with its own deadline.
- `internal/georeconcile` — the venue geography refresh: the bounded pass over published rows still missing coordinates, the lookup resolve, and the attempt/backoff rules.
- `internal/search` — the structured query: filter validation and bounds, the optional proximity predicate and distance order over the projection's geography, the SQL, and the gRPC handler.
- `internal/interests` — the attendee preference record: bounds and normalisation, the SQL over that record, and its gRPC handler.
- `internal/recommendations` — the recommendation query: preference rendering, the store lookup, Event Service's candidate resolution, the origin-based distance blend, and its gRPC handler.
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

## Venue geography refresh

Coordinates are Event Service content: the published resolve copies them into the index row together with the rest of the venue, and a projection written while Event Service already serves them needs nothing more. A projection can also be written before the coordinates exist — a draft published ahead of the organizer's venue, or a database backfilled after the fact — so `internal/georeconcile` keeps a work row for every published row still missing both coordinates.

Each bounded pass claims due rows with `FOR UPDATE SKIP LOCKED`, resolves the event through the same lookup and deadline the consumer uses, and writes the coordinates into the index row. An event Event Service authoritatively serves without coordinates closes the work instead of retrying. A failed resolve spends an attempt and reschedules on a doubling backoff capped at one hour, so a dead Event Service retries without hot-looping and never drops the claim. The work table carries claims, not content: its completion is the row's removal.

## Behaviour consumers

Commerce appends `commerce.order-paid.v1` to its order outbox and Ticket appends `ticket.checked-in.v1` to its ticket outbox; their Debezium lanes relay the facts to `eventa.commerce.order.v1` and `eventa.ticket.check-in.v1`. Discovery reads each topic as its own group member (`<group>-commerce`, `<group>-check-in>`) beside the lifecycle group, so a stall in one topic never rebalances another.

The classification rule is the lifecycle consumer's: a fact of another type on either topic — a refund, a revocation — is acknowledged and skipped so a shared topic never stalls, and a record that claims to be ours but breaks the contract is left uncommitted so the broker redelivers it until the producer is corrected. An accepted fact enters one transaction that claims `discovery_behaviour_inbox` on `(event_type, message_id)` and upserts `discovery_attendee_behaviour` on `(attendee_id, event_id, kind)`. Evidence is one row per attendee, event, and kind: a repeat purchase or a second ticket moves `occurred_at` forward instead of adding weight, and a replay finds its inbox row and commits without a second write.

Outcomes are `processed`, `duplicate`, `ignored`, and `rejected`, carried on `discovery.attendee_behaviour`.

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

## Attendee interests

Interests belong to Discovery, not to Identity: registration stays an Identity transaction, and an attendee manages their interests afterwards. The attendee id arrives from the Gateway's authenticated session and Discovery stores the list against it without ever resolving an account.

A save replaces the whole list in one statement after the request is bounded and normalised, so a repeated submission cannot append to itself. The list is derived from what the attendee typed and can be rebuilt the same way; it is one of the two inputs the recommendation query renders.

## Recommendations

`DiscoveryService.RecommendEvents` combines the three inputs the service already owns: the interest record, the behaviour evidence, and the semantic store. It reads the stored interests and the attendee's most recent evidence — up to 12 attended and 12 purchased rows, newest first, joined to projection content — and renders them through `semantic.BuildPreferences` into one query text. The text is budgeted by evidence strength: each tier of the 1800-byte budget is guaranteed its share (attended 900, purchased 600, interests 300) and passes what it cannot use down the weight order, so attended outweighs purchased outweighs what the attendee said at signup by construction, and an interests-only attendee still renders up to the full budget. `Store.Search` embeds that one text in the proxy and returns the closest events with their cosine scores, in the same store that indexing fills, so the preference text and the event corpus are embedded by one model and compared in one index.

An attendee with no interests and no behaviour evidence gets an empty list: that is the cold-start position, not a failure. An attendee with only behaviour evidence is served — that is the point of the evidence.

Ranking is Discovery's; authority is Event Service's. The candidate ids go to `lookup.ListRecommendableEvents`, and only the events Event Service still serves come back — publication, retirement, start time, live sales, and remaining capacity are all decided there. The answer drops what Event Service did not return and stops at the requested limit, so a cancelled event disappears without Discovery holding a second opinion about its state.

When the request reports an origin, distance joins that ranking as one bounded signal (`internal/recommendations/rank.go`). Each resolved candidate whose venue carries coordinates gains a proximity factor — 1 at the origin, falling linearly to 0 from 50 km — and its ordering value becomes the store's cosine score at 80% plus that factor at 20%. The scales never meet raw: kilometres become the bounded factor first, and the weight is the only place it combines with similarity. A candidate without coordinates, or a request without an origin, ranks on similarity alone — location can move a page but never decides it — and a stable sort keeps equal scores in store order. Distances are great-circle kilometres computed in memory from the content Event Service already returned, so the ranking adds no query, and the response carries `distance_km` for every located event when an origin was given.

No preference vector is stored. Ahnlich embeds the preference text at query time, so there is no derived attendee state to reconcile: losing the store costs one search, never the interests or the evidence. The evidence rows themselves are durable facts recorded from the broker and are never rebuilt.

## Similar events

`DiscoveryService.SimilarEvents` answers that question for one event instead of one attendee. It reads the source event from `discovery_event_index` and renders it through the same `semantic.BuildText` the indexer used, so the query embeds in the same vector space as the entry the store already holds; an event Discovery does not hold as published with content is reported as not found rather than guessed at. Candidates are deduplicated, the source event is removed, and the survivors go to `lookup.ListRecommendableEvents`, so the answer keeps the store's order without the source itself and without anything Event Service no longer serves.

The page bounds, candidate handling, response shape, and Event Service failure translation live in `internal/ranking` and are shared with recommendations, so the two similarity APIs cannot drift apart.

## Data ownership

The service owns `discovery_event_inbox`, `discovery_event_index`, `discovery_semantic_index`, `discovery_attendee_interests`, `discovery_behaviour_inbox`, `discovery_attendee_behaviour`, and `discovery_venue_geo_refresh` in its own PostgreSQL database. Migrations `0001_create_discovery_event_index.sql`, `0002_create_discovery_semantic_index.sql`, `0003_create_discovery_attendee_interests.sql`, `0004_create_discovery_attendee_behaviour.sql`, and `0005_add_venue_geography.sql` create them; `0005` adds the nullable coordinate columns, the generated `venue_geo` geography point derived from them, and its GiST index.

Durable invariants:

- `discovery_event_inbox` is primary-keyed on `(event_type, message_id)`, so a replayed fact cannot be recorded twice.
- `discovery_event_index` is primary-keyed on `event_id`, so one event has exactly one projection row.
- `discovery_event_index.status` is constrained to `published` or `cancelled`.
- `version` and the content columns are nullable: a tombstone for an event never indexed carries no version, and a publication Event no longer serves carries no content.
- `discovery_semantic_index` is primary-keyed on `event_id`, so one event records exactly one store state.
- `discovery_semantic_index.status` is constrained to `pending_index`, `indexed`, `pending_removal`, or `removed`, and an indexed row must carry the content hash it was pushed with.
- `discovery_attendee_interests` is primary-keyed on `attendee_id`, so one attendee has exactly one stored list, and it is constrained to at most 50 interests.
- `discovery_behaviour_inbox` is primary-keyed on `(event_type, message_id)`, so a replayed behaviour fact cannot be recorded twice.
- `discovery_attendee_behaviour` is primary-keyed on `(attendee_id, event_id, kind)`, so one attendee records one occurrence per event per kind; a repeat moves `occurred_at` forward instead of adding weight.
- Venue coordinates are both present or both null, and `venue_geo` is a stored generated point, so the searchable geography can never disagree with the columns it derives from.
- `discovery_venue_geo_refresh` is primary-keyed on `event_id`, so one event holds at most one geography claim; completion removes the row, and a spent attempt schedules the next one.
- The projection is a copy for retrieval and rebuild. It never answers whether an event is on sale or available; those come from Event Service. Its geography is copied from Event Service too, so a proximity query computes distance over that copy and never decides where an event is.

## Dependencies

- PostgreSQL — own schema only
- Kafka — the shared event lifecycle topic plus the commerce order and ticket check-in topics, one group per topic, manual commits
- Event Service over internal gRPC, with an explicit deadline
- The API Gateway calls this service over internal gRPC, with its own deadline
- Ahnlich AI proxy over internal gRPC, with its own deadline, for the derived semantic index
- OTLP collector — traces and metrics

Readiness covers only the database. Kafka group membership recovers through the consumer's own restart backoff, Event Service is dialled per call, and Ahnlich is a derived-state dependency that reports through the pending gauge and the canary, so none is a reason to report an instance unready; telemetry availability never gates startup or readiness.

## Shutdown

SIGTERM or SIGINT stops the HTTP health server, gracefully stops the query API, cancels the reconciler, leaves the Kafka groups, closes the Event gRPC connection and the semantic store connection, drains the pool, then flushes traces and the final metric batch. In-flight messages are left unacknowledged so the broker redelivers them rather than losing them.
