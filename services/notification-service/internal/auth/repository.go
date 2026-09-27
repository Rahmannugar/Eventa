package auth

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

const timestampLayout = "2006-01-02T15:04:05.000Z07:00"

// ClaimKind classifies what a claim attempt resolved to.
type ClaimKind int

const (
	// Claimed means the caller now holds the lease and must report a terminal
	// state or a scheduled retry before the lease expires.
	Claimed ClaimKind = iota
	// Busy means another attempt owns the delivery right now.
	Busy
	// Conflict means the stored row describes a different job than the one in
	// the message, so nothing may be delivered.
	Conflict
	// Terminal means the delivery has already finished.
	Terminal
)

// Claim is the result of one claim attempt.
type Claim struct {
	Kind       ClaimKind
	Attempt    int
	ClaimToken string
	RetryAt    time.Time
	Status     string
}

// Repository owns the auth_email_deliveries state machine. Every transition is
// guarded by the row lock or the claim token, never by an application check.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository binds the repository to the service's own pool.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

// Claim inserts the delivery row if it is new, takes the row lock, and either
// grants a lease or reports why it cannot.
func (r *Repository) Claim(ctx context.Context, job Job) (Claim, error) {
	ctx, span := telemetry.StartSpan(ctx, "auth_email_delivery.claim", trace.SpanKindClient,
		attribute.String("db.collection.name", "auth_email_deliveries"),
		attribute.String("db.namespace", "eventa_notification"),
		attribute.String("db.operation.name", "UPDATE"),
		attribute.String("db.system.name", "postgresql"),
	)
	claim, err := r.claim(ctx, job)
	telemetry.EndSpan(span, err)
	return claim, err
}

func (r *Repository) claim(ctx context.Context, job Job) (Claim, error) {
	expiresAt, err := time.Parse(time.RFC3339Nano, job.ExpiresAt)
	if err != nil {
		return Claim{}, fmt.Errorf("parse job expiry: %w", err)
	}

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

	if _, err := tx.Exec(ctx, `
		INSERT INTO auth_email_deliveries (job_id, job_type, status, expires_at)
		VALUES ($1, $2, 'pending', $3)
		ON CONFLICT (job_id) DO NOTHING
	`, job.JobID, job.Type, expiresAt); err != nil {
		return Claim{}, fmt.Errorf("insert delivery: %w", err)
	}

	var now time.Time
	if err := tx.QueryRow(ctx, `SELECT NOW() AS now`).Scan(&now); err != nil {
		return Claim{}, fmt.Errorf("read database clock: %w", err)
	}

	var (
		storedJobType string
		storedExpiry  time.Time
		status        string
		attemptCount  int
		leaseExpires  *time.Time
		nextAttempt   *time.Time
	)
	err = tx.QueryRow(ctx, `
		SELECT attempt_count, expires_at, job_type, lease_expires_at,
		       next_attempt_at, status
		FROM auth_email_deliveries
		WHERE job_id = $1
		FOR UPDATE
	`, job.JobID).Scan(&attemptCount, &storedExpiry, &storedJobType, &leaseExpires, &nextAttempt, &status)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Claim{}, errors.New("AUTH_EMAIL_DELIVERY_CLAIM_UNAVAILABLE")
		}
		return Claim{}, fmt.Errorf("lock delivery: %w", err)
	}

	nowValue := now.UTC().Format(timestampLayout)

	if storedJobType != job.Type || storedExpiry.UTC().Format(timestampLayout) != job.ExpiresAt {
		if err := commit(); err != nil {
			return Claim{}, err
		}
		return Claim{Kind: Conflict}, nil
	}

	if isTerminalStatus(status) {
		if err := commit(); err != nil {
			return Claim{}, err
		}
		return Claim{Kind: Terminal, Status: status}, nil
	}

	if !storedExpiry.After(now) {
		if _, err := tx.Exec(ctx, `
			UPDATE auth_email_deliveries
			SET status = 'expired', failure_code = 'JOB_EXPIRED',
			    processing_token = NULL, lease_expires_at = NULL,
			    next_attempt_at = NULL, terminal_at = $2,
			    updated_at = $2
			WHERE job_id = $1
		`, job.JobID, nowValue); err != nil {
			return Claim{}, fmt.Errorf("expire delivery: %w", err)
		}
		if err := commit(); err != nil {
			return Claim{}, err
		}
		return Claim{Kind: Terminal, Status: "expired"}, nil
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
			UPDATE auth_email_deliveries
			SET status = 'failed', failure_code = 'ATTEMPTS_EXHAUSTED',
			    processing_token = NULL, lease_expires_at = NULL,
			    next_attempt_at = NULL, terminal_at = $2,
			    updated_at = $2
			WHERE job_id = $1
		`, job.JobID, nowValue); err != nil {
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
		UPDATE auth_email_deliveries
		SET status = 'processing',
		    attempt_count = attempt_count + 1,
		    failure_code = NULL,
		    processing_token = $2,
		    lease_expires_at = $3,
		    next_attempt_at = NULL,
		    updated_at = $4
		WHERE job_id = $1
	`, job.JobID, claimToken, leaseExpiresAt, nowValue); err != nil {
		return Claim{}, fmt.Errorf("lease delivery: %w", err)
	}
	if err := commit(); err != nil {
		return Claim{}, err
	}

	return Claim{Kind: Claimed, Attempt: attemptCount + 1, ClaimToken: claimToken}, nil
}

// MarkDelivered records an accepted provider response. It returns false when the
// lease is no longer held, which sends the caller back through recovery.
func (r *Repository) MarkDelivered(ctx context.Context, jobID, claimToken, providerMessageID string) (bool, error) {
	return r.guardedUpdate(ctx, `
		UPDATE auth_email_deliveries
		SET status = 'delivered', provider_message_id = $3,
		    failure_code = NULL, processing_token = NULL,
		    lease_expires_at = NULL, next_attempt_at = NULL,
		    delivered_at = NOW(), terminal_at = NOW(), updated_at = NOW()
		WHERE job_id = $1 AND status = 'processing'
		  AND processing_token = $2
		RETURNING job_id
	`, jobID, claimToken, providerMessageID)
}

// MarkExpired records a delivery that reached its job expiry.
func (r *Repository) MarkExpired(ctx context.Context, jobID, claimToken string) (bool, error) {
	return r.guardedUpdate(ctx, `
		UPDATE auth_email_deliveries
		SET status = 'expired', failure_code = 'JOB_EXPIRED',
		    processing_token = NULL, lease_expires_at = NULL,
		    next_attempt_at = NULL, terminal_at = NOW(), updated_at = NOW()
		WHERE job_id = $1 AND status = 'processing'
		  AND processing_token = $2
		RETURNING job_id
	`, jobID, claimToken)
}

// MarkFailed records a delivery that must not be attempted again.
func (r *Repository) MarkFailed(ctx context.Context, jobID, claimToken, failureCode string) (bool, error) {
	return r.guardedUpdate(ctx, `
		UPDATE auth_email_deliveries
		SET status = 'failed', failure_code = $3,
		    processing_token = NULL, lease_expires_at = NULL,
		    next_attempt_at = NULL, terminal_at = NOW(), updated_at = NOW()
		WHERE job_id = $1 AND status = 'processing'
		  AND processing_token = $2
		RETURNING job_id
	`, jobID, claimToken, failureCode)
}

// MarkRetryScheduled records when the next attempt becomes due and releases the
// lease.
func (r *Repository) MarkRetryScheduled(ctx context.Context, jobID, claimToken, failureCode string, retryAt time.Time) (bool, error) {
	return r.guardedUpdate(ctx, `
		UPDATE auth_email_deliveries
		SET status = 'retry_scheduled', failure_code = $3,
		    processing_token = NULL, lease_expires_at = NULL,
		    next_attempt_at = $4, updated_at = NOW()
		WHERE job_id = $1 AND status = 'processing'
		  AND processing_token = $2
		RETURNING job_id
	`, jobID, claimToken, failureCode, retryAt.UTC().Format(timestampLayout))
}

// RecordRejected writes the terminal state for a job the consumer refused to
// parse. The row's expiry is the database clock because no trustworthy job
// expiry was ever read.
func (r *Repository) RecordRejected(ctx context.Context, jobID, jobType, failureCode string) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO auth_email_deliveries (
			job_id, job_type, status, attempt_count, failure_code,
			expires_at, terminal_at
		)
		VALUES ($1, $2, 'rejected', 0, $3, NOW(), NOW())
		ON CONFLICT (job_id) DO NOTHING
	`, jobID, jobType, failureCode)
	if err != nil {
		return fmt.Errorf("record rejected delivery: %w", err)
	}
	return nil
}

// guardedUpdate runs a statement that only matches while the claim token still
// owns the row, and reports whether it changed anything.
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
	case "delivered", "expired", "failed", "rejected":
		return true
	default:
		return false
	}
}
