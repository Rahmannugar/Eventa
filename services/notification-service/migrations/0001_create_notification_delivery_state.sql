CREATE TABLE auth_email_deliveries (
    job_id uuid PRIMARY KEY,
    job_type text NOT NULL,
    status text NOT NULL,
    attempt_count integer NOT NULL DEFAULT 0,
    provider_message_id text,
    failure_code text,
    expires_at timestamp with time zone NOT NULL,
    processing_token uuid,
    lease_expires_at timestamp with time zone,
    next_attempt_at timestamp with time zone,
    delivered_at timestamp with time zone,
    terminal_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT auth_email_deliveries_status_valid
        CHECK (status IN ('pending', 'processing', 'retry_scheduled', 'delivered', 'failed', 'expired', 'rejected')),
    CONSTRAINT auth_email_deliveries_attempt_count_valid
        CHECK (attempt_count >= 0 AND attempt_count <= 3)
);

CREATE INDEX auth_email_deliveries_status_idx ON auth_email_deliveries (status);
CREATE INDEX auth_email_deliveries_next_attempt_idx ON auth_email_deliveries (next_attempt_at);

CREATE TABLE cancellation_email_deliveries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id uuid NOT NULL,
    attendee_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    status text NOT NULL DEFAULT 'pending',
    attempt_count integer NOT NULL DEFAULT 0,
    provider_message_id text,
    failure_code text,
    processing_token uuid,
    lease_expires_at timestamp with time zone,
    next_attempt_at timestamp with time zone,
    delivered_at timestamp with time zone,
    terminal_at timestamp with time zone,
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT cancellation_email_deliveries_event_attendee_unique UNIQUE (event_id, attendee_id),
    CONSTRAINT cancellation_email_deliveries_status_valid
        CHECK (status IN ('pending', 'processing', 'retry_scheduled', 'delivered', 'failed', 'rejected')),
    CONSTRAINT cancellation_email_deliveries_attempt_count_valid
        CHECK (attempt_count >= 0 AND attempt_count <= 3)
);

CREATE INDEX cancellation_email_deliveries_status_idx ON cancellation_email_deliveries (status);
CREATE INDEX cancellation_email_deliveries_next_attempt_idx ON cancellation_email_deliveries (next_attempt_at);

CREATE TABLE notification_job_outbox (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type text NOT NULL,
    routing_key text NOT NULL,
    event_type text NOT NULL,
    payload jsonb NOT NULL,
    occurred_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT notification_job_outbox_aggregate_type_valid
        CHECK (aggregate_type = 'eventa.notification.jobs'),
    CONSTRAINT notification_job_outbox_routing_key_valid
        CHECK (routing_key = 'eventa.notification.event-cancellation-email.v1'),
    CONSTRAINT notification_job_outbox_event_type_valid
        CHECK (event_type = 'notification.event-cancellation-email.v1')
);

CREATE TABLE ticket_revocation_inbox (
    message_id uuid PRIMARY KEY,
    event_id uuid NOT NULL,
    event_type character varying(120) NOT NULL,
    received_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT ticket_revocation_inbox_event_type_shape CHECK (event_type = 'ticket.revoked.v1')
);

---- create above / drop below ----
DROP TABLE ticket_revocation_inbox;
DROP TABLE notification_job_outbox;
DROP TABLE cancellation_email_deliveries;
DROP TABLE auth_email_deliveries;
