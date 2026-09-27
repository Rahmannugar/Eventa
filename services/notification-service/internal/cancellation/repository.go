package cancellation

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/eventa/notification-service/internal/telemetry"
)

// timestampLayout matches the ISO-8601 form the TypeScript service compared and
// wrote, so stored instants round-trip through the same string.
const timestampLayout = "2006-01-02T15:04:05.000Z07:00"

// ClaimKind classifies one claim attempt. The cancellation path has no
// conflict branch: the job carries only a delivery id, so there is no second
// value that could disagree with the row.
type ClaimKind int

const (
	// Claimed means the caller holds the lease for one attempt.
	Claimed ClaimKind = iota
	// Busy means another attempt owns the delivery right now.
	Busy
	// Terminal means the delivery has already finished.
	Terminal
)

// Claim is the result of one claim attempt.
type Claim struct {
	Kind       ClaimKind
	Attempt    int
	ClaimToken string
	AttendeeID string
	EventID    string
	RetryAt    time.Time
	Status     string
}

// RevocationKind is what one ingested fact produced.
type RevocationKind string

const (
	RevocationCreated   RevocationKind = "created"
	RevocationDuplicate RevocationKind = "duplicate"
	RevocationGrouped   RevocationKind = "grouped"
)

// Revocation is the durable record of one ingested fact.
type Revocation struct {
	Kind       RevocationKind
	DeliveryID string
	MessageID  string
}

// Repository owns ticket_revocation_inbox, cancellation_email_deliveries and
// notification_job_outbox. Every state change happens under a row lock or a
// claim token.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository binds the repository to the service's own pool.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

// RecordRevocation writes the inbox row, the delivery row and the outbox row in
// one transaction, so a failure rolls the whole fact back.
func (r *Repository) RecordRevocation(ctx context.Context, fact Fact) (Revocation, error) {
	ctx, span := telemetry.StartSpan(ctx, "cancellation_email.record_revocation", trace.SpanKindInternal)
	record, err := r.recordRevocation(ctx, fact)
	telemetry.EndSpan(span, err)
	return record, err
}

func (r *Repository) recordRevocation(ctx context.Context, fact Fact) (Revocation, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return Revocation{}, fmt.Errorf("begin record revocation: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var inboxMessageID string
	err = tx.QueryRow(ctx, `
		INSERT INTO ticket_revocation_inbox (message_id, event_id, event_type)
		VALUES ($1, $2, $3)
		ON CONFLICT (message_id) DO NOTHING
		RETURNING message_id
	`, fact.MessageID, fact.EventID, fact.Type).Scan(&inboxMessageID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			if err := tx.Commit(ctx); err != nil {
				return Revocation{}, fmt.Errorf("commit replayed revocation: %w", err)
			}
			return Revocation{Kind: RevocationDuplicate, MessageID: fact.MessageID}, nil
		}
		return Revocation{}, fmt.Errorf("insert revocation inbox: %w", err)
	}

	var deliveryID string
	err = tx.QueryRow(ctx, `
		INSERT INTO cancellation_email_deliveries (event_id, attendee_id)
		VALUES ($1, $2)
		ON CONFLICT (event_id, attendee_id) DO NOTHING
		RETURNING id
	`, fact.EventID, fact.AttendeeID).Scan(&deliveryID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// The inbox row stays: the fact arrived, it simply needs no new
			// email for this attendee.
			if err := tx.Commit(ctx); err != nil {
				return Revocation{}, fmt.Errorf("commit grouped revocation: %w", err)
			}
			return Revocation{Kind: RevocationGrouped, MessageID: fact.MessageID}, nil
		}
		return Revocation{}, fmt.Errorf("insert cancellation delivery: %w", err)
	}

	payload := fmt.Sprintf(`{"deliveryId":%q,"type":%q}`, deliveryID, JobType)
	if _, err := tx.Exec(ctx, `
		INSERT INTO notification_job_outbox
			(aggregate_type, routing_key, event_type, payload)
		VALUES ($1, $2, $3, $4::jsonb)
	`, Exchange, Queue, JobType, payload); err != nil {
		return Revocation{}, fmt.Errorf("insert notification job outbox: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return Revocation{}, fmt.Errorf("commit record revocation: %w", err)
	}

	return Revocation{Kind: RevocationCreated, DeliveryID: deliveryID, MessageID: fact.MessageID}, nil
}

// Claim locks the delivery row and either grants one attempt or reports why it
// cannot.
func (r *Repository) Claim(ctx context.Context, deliveryID string) (Claim, error) {
	ctx, span := telemetry.StartSpan(ctx, "cancellation_email.claim", trace.SpanKindClient,
		attribute.String("db.collection.name", "cancellation_email_deliveries"),
		attribute.String("db.namespace", "eventa_notification"),
		attribute.String("db.operation.name", "UPDATE"),
		attribute.String("db.system.name", "postgresql"),
	)
	claim, err := r.claim(ctx, deliveryID)
	telemetry.EndSpan(span, err)
	return claim, err
}

func (r *Repository) claim(ctx context.Context, deliveryID string) (Claim, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return Claim{}, fmt.Errorf("begin claim transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	commit := func() error {
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("commit claim: %w", err)
		}
		return nil
	}

	var now time.Time
	if err := tx.QueryRow(ctx, `SELECT NOW() AS now`).Scan(&now); err != nil {
		return Claim{}, fmt.Errorf("read database clock: %w", err)
	}

	var (
		attendeeID   string
		eventID      string
		attemptCount int
		leaseExpires *time.Time
		nextAttempt  *time.Time
		status       string
	)
	err = tx.QueryRow(ctx, `
		SELECT attendee_id, attempt_count, event_id, lease_expires_at,
		       next_attempt_at, status
		FROM cancellation_email_deliveries
		WHERE id = $1
		FOR UPDATE
	`, deliveryID).Scan(&attendeeID, &attemptCount, &eventID, &leaseExpires, &nextAttempt, &status)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			if err := commit(); err != nil {
				return Claim{}, err
			}
			return Claim{Kind: Terminal, Status: "failed"}, nil
		}
		return Claim{}, fmt.Errorf("lock delivery: %w", err)
	}

	nowValue := now.UTC().Format(timestampLayout)

	if isTerminalStatus(status) {
		if err := commit(); err != nil {
			return Claim{}, err
		}
		return Claim{Kind: Terminal, Status: status}, nil
	}

	var unavailableUntil *time.Time
	switch status {
	case "processing":
		unavailableUntil = leaseExpires
	case "retry_scheduled":
		unavailableUntil = nextAttempt
	}
	if unavailableUntil != nil && unavailableUntil.After(now) {
		if err := commit(); err != nil {
			return Claim{}, err
		}
		return Claim{Kind: Busy, RetryAt: *unavailableUntil}, nil
	}

	if attemptCount >= MaxDeliveryAttempts {
		if _, err := tx.Exec(ctx, `
			UPDATE cancellation_email_deliveries
			SET status = 'failed', failure_code = 'ATTEMPTS_EXHAUSTED',
			    processing_token = NULL, lease_expires_at = NULL,
			    next_attempt_at = NULL, terminal_at = $2,
			    updated_at = $2
			WHERE id = $1
		`, deliveryID, nowValue); err != nil {
			return Claim{}, fmt.Errorf("exhaust delivery: %w", err)
		}
		if err := commit(); err != nil {
			return Claim{}, err
		}
		return Claim{Kind: Terminal, Status: "failed"}, nil
	}

	claimToken := uuid.NewString()
	leaseExpiresAt := now.Add(time.Duration(ProcessingLeaseMS) * time.Millisecond).UTC().Format(timestampLayout)

	if _, err := tx.Exec(ctx, `
		UPDATE cancellation_email_deliveries
		SET status = 'processing',
		    attempt_count = attempt_count + 1,
		    failure_code = NULL,
		    processing_token = $2,
		    lease_expires_at = $3,
		    next_attempt_at = NULL,
		    updated_at = $4
		WHERE id = $1
	`, deliveryID, claimToken, leaseExpiresAt, nowValue); err != nil {
		return Claim{}, fmt.Errorf("lease delivery: %w", err)
	}
	if err := commit(); err != nil {
		return Claim{}, err
	}

	return Claim{
		Kind:       Claimed,
		Attempt:    attemptCount + 1,
		ClaimToken: claimToken,
		AttendeeID: attendeeID,
		EventID:    eventID,
	}, nil
}

// MarkDelivered records an accepted provider response.
func (r *Repository) MarkDelivered(ctx context.Context, deliveryID, claimToken, providerMessageID string) (bool, error) {
	return r.guardedUpdate(ctx, `
		UPDATE cancellation_email_deliveries
		SET status = 'delivered', provider_message_id = $3,
		    failure_code = NULL, processing_token = NULL,
		    lease_expires_at = NULL, next_attempt_at = NULL,
		    delivered_at = NOW(), terminal_at = NOW(), updated_at = NOW()
		WHERE id = $1 AND status = 'processing'
		  AND processing_token = $2
		  RETURNING id
	`, deliveryID, claimToken, providerMessageID)
}

// MarkFailed records a delivery that must not be attempted again.
func (r *Repository) MarkFailed(ctx context.Context, deliveryID, claimToken, failureCode string) (bool, error) {
	return r.guardedUpdate(ctx, `
		UPDATE cancellation_email_deliveries
		SET status = 'failed', failure_code = $3,
		    processing_token = NULL, lease_expires_at = NULL,
		    next_attempt_at = NULL, terminal_at = NOW(), updated_at = NOW()
		WHERE id = $1 AND status = 'processing'
		  AND processing_token = $2
		  RETURNING id
	`, deliveryID, claimToken, failureCode)
}

// MarkRetryScheduled records when the next attempt becomes due.
func (r *Repository) MarkRetryScheduled(ctx context.Context, deliveryID, claimToken, failureCode string, retryAt time.Time) (bool, error) {
	return r.guardedUpdate(ctx, `
		UPDATE cancellation_email_deliveries
		SET status = 'retry_scheduled', failure_code = $3,
		    processing_token = NULL, lease_expires_at = NULL,
		    next_attempt_at = $4, updated_at = NOW()
		WHERE id = $1 AND status = 'processing'
		  AND processing_token = $2
		  RETURNING id
	`, deliveryID, claimToken, failureCode, retryAt.UTC().Format(timestampLayout))
}

// RecordRejected terminally marks a delivery whose job payload was refused. It
// never touches a delivery that already finished.
func (r *Repository) RecordRejected(ctx context.Context, deliveryID, failureCode string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE cancellation_email_deliveries
		SET status = 'rejected', failure_code = $2,
		    processing_token = NULL, lease_expires_at = NULL,
		    next_attempt_at = NULL, terminal_at = NOW(), updated_at = NOW()
		WHERE id = $1
		  AND status NOT IN ('delivered', 'failed', 'rejected')
	`, deliveryID, failureCode)
	if err != nil {
		return fmt.Errorf("record rejected delivery: %w", err)
	}
	return nil
}

func (r *Repository) guardedUpdate(ctx context.Context, statement string, args ...any) (bool, error) {
	var matched string
	err := r.pool.QueryRow(ctx, statement, args...).Scan(&matched)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, fmt.Errorf("finish delivery: %w", err)
	}
	return true, nil
}

func isTerminalStatus(status string) bool {
	switch status {
	case "delivered", "failed", "rejected":
		return true
	default:
		return false
	}
}
