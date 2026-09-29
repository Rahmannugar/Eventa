# Discovery Architecture

Gateway owns the public search boundary and the attendee interest boundary. It validates the query shape, applies attendee-specific abuse controls, resolves the attendee from the server-backed session, and calls `DiscoveryService.SearchEvents` over internal gRPC under a deadline shorter than the outer HTTP request budget.

Interest requests always carry the attendee id taken from the server-backed session, so an attendee can only read or write their own record. `PUT` replaces the list after DTO validation bounds it, and Discovery applies the same bounds again before writing.

Discovery Service owns filter semantics: which rows match, how categories and time bounds are compared, ordering, pagination, and the public result shape. Gateway never reads a projection row, joins data, or widens a filter. A Discovery `INVALID_ARGUMENT` becomes a correctable `400`; every other dependency failure becomes `503`, so callers never learn whether the failure was a timeout, a database error, or a contract mismatch.

Search is behind the attendee authentication guard and a dedicated rate-limit guard keyed by `event-search`, so search budgets are independent of other attendee reads. Interests have their own guards keyed by `interests-read` and `interests-write`, with a smaller write budget than read budget. The correlation id is forwarded on the call and appears in the Discovery log line and trace.

Gateway holds no search state and no preference state. Relevance, semantic ranking, and preference-derived results arrive with later slices against the same projection.
