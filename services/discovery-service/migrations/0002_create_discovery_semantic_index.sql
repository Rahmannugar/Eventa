CREATE TABLE discovery_semantic_index (
    event_id uuid PRIMARY KEY,
    status text NOT NULL,
    content_hash text,
    attempts integer NOT NULL DEFAULT 0,
    last_error text,
    pushed_at timestamp with time zone,
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT discovery_semantic_index_status_valid
        CHECK (status IN ('pending_index', 'indexed', 'pending_removal', 'removed')),
    CONSTRAINT discovery_semantic_index_content_hash_valid
        CHECK (content_hash IS NOT NULL OR status IN ('pending_removal', 'removed'))
);

CREATE INDEX discovery_semantic_index_status_idx
    ON discovery_semantic_index (status, updated_at);

---- create above / drop below ----
DROP TABLE discovery_semantic_index;
