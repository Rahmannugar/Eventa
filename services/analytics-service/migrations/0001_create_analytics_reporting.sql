CREATE TABLE analytics_event_inbox (
    event_type text NOT NULL,
    message_id uuid NOT NULL,
    event_id uuid NOT NULL,
    received_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT analytics_event_inbox_event_type_valid
        CHECK (event_type IN (
            'commerce.order-paid.v1',
            'commerce.order-refunded.v1',
            'ticket.checked-in.v1',
            'ticket.revoked.v1',
            'event.published.v1',
            'event.cancelled.v1'
        )),
    CONSTRAINT analytics_event_inbox_pkey PRIMARY KEY (event_type, message_id)
);

CREATE TABLE analytics_event_performance (
    event_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'published',
    currency text,
    tickets_sold bigint NOT NULL DEFAULT 0,
    tickets_refunded bigint NOT NULL DEFAULT 0,
    tickets_checked_in bigint NOT NULL DEFAULT 0,
    tickets_revoked bigint NOT NULL DEFAULT 0,
    gross_revenue_minor bigint NOT NULL DEFAULT 0,
    refunded_revenue_minor bigint NOT NULL DEFAULT 0,
    published_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT analytics_event_performance_pkey PRIMARY KEY (event_id),
    CONSTRAINT analytics_event_performance_status_valid
        CHECK (status IN ('published', 'cancelled')),
    CONSTRAINT analytics_event_performance_currency_valid
        CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$')
);

---- create above / drop below ----
DROP TABLE analytics_event_performance;
DROP TABLE analytics_event_inbox;
