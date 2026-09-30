# Discovery Architecture

Gateway owns the public search boundary and the attendee interest and recommendation boundaries. It validates the query shape, applies attendee-specific abuse controls, resolves the attendee from the server-backed session, and calls `DiscoveryService.SearchEvents` over internal gRPC under a deadline shorter than the outer HTTP request budget.

Interest requests always carry the attendee id taken from the server-backed session, so an attendee can only read or write their own record. `PUT` replaces the list after DTO validation bounds it, and Discovery applies the same bounds again before writing.

Discovery Service owns filter semantics: which rows match, how categories and time bounds are compared, ordering, pagination, and the public result shape. Gateway never reads a projection row, joins data, or widens a filter. A Discovery `INVALID_ARGUMENT` becomes a correctable `400`; every other dependency failure becomes `503`, so callers never learn whether the failure was a timeout, a database error, or a contract mismatch.

Search is behind the attendee authentication guard and a dedicated rate-limit guard keyed by `event-search`, so search budgets are independent of other attendee reads. Interests have their own guards keyed by `interests-read` and `interests-write`, with a smaller write budget than read budget, and recommendations have one keyed by `recommendations-read`, metered tighter than search because each call embeds and resolves. Similar events have one keyed by `similar-events-read` with the same tightness as a recommendation and no authentication guard, because the route is public. The correlation id is forwarded on the call and appears in the Discovery log line and trace.

`GET /events/:eventId/similar` is public, matching the event detail route it sits beside: the path id is validated as a UUID, Discovery decides whether it holds that event, and its `NOT_FOUND` becomes `404 EVENT_NOT_FOUND` while every dependency failure stays `503`. Discovery Service embeds the event's own text, ranks its neighbours, drops the source event, and lets Event Service confirm which of them it still serves; Gateway validates the page size and renders the answer.

Gateway holds no search state and no preference state. Ranking comes from Discovery, which compares the attendee's stored interests against the semantic index; Event Service then decides which candidates are still served. Gateway validates the page size, takes the attendee from the server-backed session, and renders the answer.
