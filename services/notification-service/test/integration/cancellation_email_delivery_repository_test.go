package integration

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/eventa/notification-service/internal/cancellation"
)

func seedCancellationDelivery(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO cancellation_email_deliveries (event_id, attendee_id)
		VALUES ($1, $2)
		RETURNING id
	`, uuid.NewString(), uuid.NewString()).Scan(&id); err != nil {
		t.Fatalf("seed cancellation delivery: %v", err)
	}
	return id
}

func cancellationStatusOf(t *testing.T, pool *pgxpool.Pool, deliveryID string) string {
	t.Helper()
	var status string
	if err := pool.QueryRow(context.Background(),
		`SELECT status FROM cancellation_email_deliveries WHERE id = $1`, deliveryID).Scan(&status); err != nil {
		t.Fatalf("read status: %v", err)
	}
	return status
}

func TestCancellationClaimLeasesAPendingDelivery(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetCancellation(t, pool)
	repository := cancellation.NewRepository(pool)
	deliveryID := seedCancellationDelivery(t, pool)

	claim, err := repository.Claim(context.Background(), deliveryID)
	if err != nil {
		t.Fatalf("Claim error = %v", err)
	}
	if claim.Kind != cancellation.Claimed {
		t.Fatalf("kind = %v, want Claimed", claim.Kind)
	}
	if claim.Attempt != 1 {
		t.Errorf("attempt = %d, want 1", claim.Attempt)
	}
	if claim.ClaimToken == "" {
		t.Error("claim token is empty")
	}
	if status := cancellationStatusOf(t, pool, deliveryID); status != "processing" {
		t.Errorf("status = %s, want processing", status)
	}
}

func TestCancellationClaimIsBusyWhileTheLeaseHolds(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetCancellation(t, pool)
	repository := cancellation.NewRepository(pool)
	deliveryID := seedCancellationDelivery(t, pool)

	if _, err := repository.Claim(context.Background(), deliveryID); err != nil {
		t.Fatalf("first Claim error = %v", err)
	}
	claim, err := repository.Claim(context.Background(), deliveryID)
	if err != nil {
		t.Fatalf("second Claim error = %v", err)
	}
	if claim.Kind != cancellation.Busy {
		t.Fatalf("kind = %v, want Busy", claim.Kind)
	}
	if !claim.RetryAt.After(time.Now()) {
		t.Errorf("RetryAt = %v, want a future lease expiry", claim.RetryAt)
	}
}

func TestOnlyTheCancellationTokenCanCompleteTheDelivery(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetCancellation(t, pool)
	repository := cancellation.NewRepository(pool)
	deliveryID := seedCancellationDelivery(t, pool)

	claim, err := repository.Claim(context.Background(), deliveryID)
	if err != nil {
		t.Fatalf("Claim error = %v", err)
	}

	matched, err := repository.MarkDelivered(context.Background(), deliveryID, uuid.NewString(), "provider-1")
	if err != nil {
		t.Fatalf("MarkDelivered error = %v", err)
	}
	if matched {
		t.Error("a stale claim token completed the delivery")
	}

	matched, err = repository.MarkDelivered(context.Background(), deliveryID, claim.ClaimToken, "provider-1")
	if err != nil {
		t.Fatalf("MarkDelivered error = %v", err)
	}
	if !matched {
		t.Error("the owning claim token did not complete the delivery")
	}
	if status := cancellationStatusOf(t, pool, deliveryID); status != "delivered" {
		t.Errorf("status = %s, want delivered", status)
	}
}

func TestStaleCancellationTokenCannotScheduleARetry(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetCancellation(t, pool)
	repository := cancellation.NewRepository(pool)
	deliveryID := seedCancellationDelivery(t, pool)

	claim, err := repository.Claim(context.Background(), deliveryID)
	if err != nil {
		t.Fatalf("Claim error = %v", err)
	}

	retryAt := time.Now().UTC().Add(5 * time.Second)
	matched, err := repository.MarkRetryScheduled(context.Background(), deliveryID, uuid.NewString(), "EMAIL_PROVIDER_TIMEOUT", retryAt)
	if err != nil {
		t.Fatalf("MarkRetryScheduled error = %v", err)
	}
	if matched {
		t.Error("a stale claim token scheduled a retry")
	}

	matched, err = repository.MarkRetryScheduled(context.Background(), deliveryID, claim.ClaimToken, "EMAIL_PROVIDER_TIMEOUT", retryAt)
	if err != nil {
		t.Fatalf("MarkRetryScheduled error = %v", err)
	}
	if !matched {
		t.Error("the owning claim token did not schedule a retry")
	}
	if status := cancellationStatusOf(t, pool, deliveryID); status != "retry_scheduled" {
		t.Errorf("status = %s, want retry_scheduled", status)
	}
}

func TestCancellationRetryBecomesClaimableAfterItsDelay(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetCancellation(t, pool)
	repository := cancellation.NewRepository(pool)
	deliveryID := seedCancellationDelivery(t, pool)

	claim, err := repository.Claim(context.Background(), deliveryID)
	if err != nil {
		t.Fatalf("Claim error = %v", err)
	}
	matched, err := repository.MarkRetryScheduled(context.Background(), deliveryID, claim.ClaimToken,
		"EMAIL_PROVIDER_TIMEOUT", time.Now().UTC().Add(-time.Second))
	if err != nil || !matched {
		t.Fatalf("MarkRetryScheduled matched = %t, err = %v", matched, err)
	}

	second, err := repository.Claim(context.Background(), deliveryID)
	if err != nil {
		t.Fatalf("second Claim error = %v", err)
	}
	if second.Kind != cancellation.Claimed {
		t.Fatalf("kind = %v, want Claimed once the delay elapsed", second.Kind)
	}
	if second.Attempt != 2 {
		t.Errorf("attempt = %d, want 2", second.Attempt)
	}
}

func TestCancellationClaimAtMaxAttemptsFailsTheDelivery(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetCancellation(t, pool)
	repository := cancellation.NewRepository(pool)

	var deliveryID string
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO cancellation_email_deliveries (event_id, attendee_id, attempt_count)
		VALUES ($1, $2, $3)
		RETURNING id
	`, uuid.NewString(), uuid.NewString(), cancellation.MaxDeliveryAttempts).Scan(&deliveryID); err != nil {
		t.Fatalf("seed exhausted cancellation delivery: %v", err)
	}

	claim, err := repository.Claim(context.Background(), deliveryID)
	if err != nil {
		t.Fatalf("Claim error = %v", err)
	}
	if claim.Kind != cancellation.Terminal || claim.Status != "failed" {
		t.Fatalf("claim = %+v, want a terminal failure", claim)
	}

	var failureCode string
	if err := pool.QueryRow(context.Background(),
		`SELECT failure_code FROM cancellation_email_deliveries WHERE id = $1`, deliveryID).Scan(&failureCode); err != nil {
		t.Fatalf("read failure code: %v", err)
	}
	if failureCode != "ATTEMPTS_EXHAUSTED" {
		t.Errorf("failure code = %s, want ATTEMPTS_EXHAUSTED", failureCode)
	}
}

func TestMissingCancellationDeliveryIsReportedAsFailed(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetCancellation(t, pool)
	repository := cancellation.NewRepository(pool)

	claim, err := repository.Claim(context.Background(), uuid.NewString())
	if err != nil {
		t.Fatalf("Claim error = %v", err)
	}
	if claim.Kind != cancellation.Terminal || claim.Status != "failed" {
		t.Fatalf("claim = %+v, want a terminal failure", claim)
	}
}

func TestCancellationRecordRejectedSkipsATerminalRow(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetCancellation(t, pool)
	repository := cancellation.NewRepository(pool)

	var deliveryID string
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO cancellation_email_deliveries (event_id, attendee_id, status)
		VALUES ($1, $2, 'delivered')
		RETURNING id
	`, uuid.NewString(), uuid.NewString()).Scan(&deliveryID); err != nil {
		t.Fatalf("seed delivered cancellation delivery: %v", err)
	}

	if err := repository.RecordRejected(context.Background(), deliveryID, "JOB_FIELDS_INVALID"); err != nil {
		t.Fatalf("RecordRejected error = %v", err)
	}
	if status := cancellationStatusOf(t, pool, deliveryID); status != "delivered" {
		t.Errorf("status = %s, want delivered", status)
	}
}
