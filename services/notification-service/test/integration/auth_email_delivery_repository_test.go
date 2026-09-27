package integration

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/eventa/notification-service/internal/auth"
)

const jobType = "attendee.email-verification.v1"

func newTestJob(t *testing.T) auth.Job {
	t.Helper()
	return auth.Job{
		JobID:          uuid.NewString(),
		Type:           jobType,
		RecipientEmail: "attendee@example.com",
		ExpiresAt:      time.Now().UTC().Add(time.Hour).Format("2006-01-02T15:04:05.000Z"),
		Secret:         "123456",
	}
}

func statusOf(t *testing.T, pool *pgxpool.Pool, jobID string) string {
	t.Helper()
	var status string
	if err := pool.QueryRow(context.Background(),
		`SELECT status FROM auth_email_deliveries WHERE job_id = $1`, jobID).Scan(&status); err != nil {
		t.Fatalf("read status: %v", err)
	}
	return status
}

func TestFirstClaimLeasesAPendingDelivery(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetDeliveries(t, pool)
	repository := auth.NewRepository(pool)
	job := newTestJob(t)

	claim, err := repository.Claim(context.Background(), job)
	if err != nil {
		t.Fatalf("Claim error = %v", err)
	}
	if claim.Kind != auth.Claimed {
		t.Fatalf("kind = %v, want Claimed", claim.Kind)
	}
	if claim.Attempt != 1 {
		t.Errorf("attempt = %d, want 1", claim.Attempt)
	}
	if claim.ClaimToken == "" {
		t.Error("claim token is empty")
	}
	if statusOf(t, pool, job.JobID) != "processing" {
		t.Errorf("status = %s, want processing", statusOf(t, pool, job.JobID))
	}
}

func TestSecondClaimIsBusyWhileTheLeaseHolds(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetDeliveries(t, pool)
	repository := auth.NewRepository(pool)
	job := newTestJob(t)

	if _, err := repository.Claim(context.Background(), job); err != nil {
		t.Fatalf("first Claim error = %v", err)
	}

	claim, err := repository.Claim(context.Background(), job)
	if err != nil {
		t.Fatalf("second Claim error = %v", err)
	}
	if claim.Kind != auth.Busy {
		t.Fatalf("kind = %v, want Busy", claim.Kind)
	}
	if !claim.RetryAt.After(time.Now()) {
		t.Errorf("RetryAt = %v, want a future lease expiry", claim.RetryAt)
	}
}

func TestOnlyTheClaimTokenCanCompleteTheDelivery(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetDeliveries(t, pool)
	repository := auth.NewRepository(pool)
	job := newTestJob(t)

	claim, err := repository.Claim(context.Background(), job)
	if err != nil {
		t.Fatalf("Claim error = %v", err)
	}

	matched, err := repository.MarkDelivered(context.Background(), job.JobID, uuid.NewString(), "provider-1")
	if err != nil {
		t.Fatalf("MarkDelivered error = %v", err)
	}
	if matched {
		t.Error("a stale claim token completed the delivery")
	}

	matched, err = repository.MarkDelivered(context.Background(), job.JobID, claim.ClaimToken, "provider-1")
	if err != nil {
		t.Fatalf("MarkDelivered error = %v", err)
	}
	if !matched {
		t.Error("the owning claim token did not complete the delivery")
	}
	if status := statusOf(t, pool, job.JobID); status != "delivered" {
		t.Errorf("status = %s, want delivered", status)
	}
}

func TestStaleTokenCannotScheduleARetry(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetDeliveries(t, pool)
	repository := auth.NewRepository(pool)
	job := newTestJob(t)

	claim, err := repository.Claim(context.Background(), job)
	if err != nil {
		t.Fatalf("Claim error = %v", err)
	}

	retryAt := time.Now().UTC().Add(5 * time.Second)
	matched, err := repository.MarkRetryScheduled(context.Background(), job.JobID, uuid.NewString(), "EMAIL_PROVIDER_TIMEOUT", retryAt)
	if err != nil {
		t.Fatalf("MarkRetryScheduled error = %v", err)
	}
	if matched {
		t.Error("a stale claim token scheduled a retry")
	}

	matched, err = repository.MarkRetryScheduled(context.Background(), job.JobID, claim.ClaimToken, "EMAIL_PROVIDER_TIMEOUT", retryAt)
	if err != nil {
		t.Fatalf("MarkRetryScheduled error = %v", err)
	}
	if !matched {
		t.Error("the owning claim token did not schedule a retry")
	}
	if status := statusOf(t, pool, job.JobID); status != "retry_scheduled" {
		t.Errorf("status = %s, want retry_scheduled", status)
	}
}

func TestScheduledRetryBecomesClaimableAfterItsDelay(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetDeliveries(t, pool)
	repository := auth.NewRepository(pool)
	job := newTestJob(t)

	claim, err := repository.Claim(context.Background(), job)
	if err != nil {
		t.Fatalf("Claim error = %v", err)
	}
	matched, err := repository.MarkRetryScheduled(context.Background(), job.JobID, claim.ClaimToken,
		"EMAIL_PROVIDER_TIMEOUT", time.Now().UTC().Add(-time.Second))
	if err != nil || !matched {
		t.Fatalf("MarkRetryScheduled matched = %t, err = %v", matched, err)
	}

	second, err := repository.Claim(context.Background(), job)
	if err != nil {
		t.Fatalf("second Claim error = %v", err)
	}
	if second.Kind != auth.Claimed {
		t.Fatalf("kind = %v, want Claimed once the delay elapsed", second.Kind)
	}
	if second.Attempt != 2 {
		t.Errorf("attempt = %d, want 2", second.Attempt)
	}
}

func TestAttemptsAlreadyAtThreeAreExhausted(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetDeliveries(t, pool)
	repository := auth.NewRepository(pool)
	job := newTestJob(t)

	if _, err := pool.Exec(context.Background(), `
		INSERT INTO auth_email_deliveries (job_id, job_type, status, attempt_count, expires_at)
		VALUES ($1, $2, 'pending', 3, $3)
	`, job.JobID, job.Type, mustTime(t, job.ExpiresAt)); err != nil {
		t.Fatalf("seed delivery: %v", err)
	}

	claim, err := repository.Claim(context.Background(), job)
	if err != nil {
		t.Fatalf("Claim error = %v", err)
	}
	if claim.Kind != auth.Terminal || claim.Status != "failed" {
		t.Fatalf("claim = %+v, want a terminal failure", claim)
	}

	var failureCode string
	if err := pool.QueryRow(context.Background(),
		`SELECT failure_code FROM auth_email_deliveries WHERE job_id = $1`, job.JobID).Scan(&failureCode); err != nil {
		t.Fatalf("read failure code: %v", err)
	}
	if failureCode != "ATTEMPTS_EXHAUSTED" {
		t.Errorf("failure code = %s, want ATTEMPTS_EXHAUSTED", failureCode)
	}
}

func TestDeliveredRowIsReportedAsTerminalWithoutRelaunching(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetDeliveries(t, pool)
	repository := auth.NewRepository(pool)
	job := newTestJob(t)

	if _, err := pool.Exec(context.Background(), `
		INSERT INTO auth_email_deliveries (job_id, job_type, status, expires_at)
		VALUES ($1, $2, 'delivered', $3)
	`, job.JobID, job.Type, mustTime(t, job.ExpiresAt)); err != nil {
		t.Fatalf("seed delivery: %v", err)
	}

	claim, err := repository.Claim(context.Background(), job)
	if err != nil {
		t.Fatalf("Claim error = %v", err)
	}
	if claim.Kind != auth.Terminal || claim.Status != "delivered" {
		t.Fatalf("claim = %+v, want a terminal delivered row", claim)
	}
}

func TestMismatchedJobTypeOnTheSameIdIsAConflict(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetDeliveries(t, pool)
	repository := auth.NewRepository(pool)
	job := newTestJob(t)

	if _, err := pool.Exec(context.Background(), `
		INSERT INTO auth_email_deliveries (job_id, job_type, status, expires_at)
		VALUES ($1, 'admin.activation.v1', 'pending', $2)
	`, job.JobID, mustTime(t, job.ExpiresAt)); err != nil {
		t.Fatalf("seed delivery: %v", err)
	}

	claim, err := repository.Claim(context.Background(), job)
	if err != nil {
		t.Fatalf("Claim error = %v", err)
	}
	if claim.Kind != auth.Conflict {
		t.Fatalf("claim = %+v, want Conflict", claim)
	}
}

func TestExpiredJobIsExpiredOnClaim(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetDeliveries(t, pool)
	repository := auth.NewRepository(pool)
	job := newTestJob(t)
	job.ExpiresAt = time.Now().UTC().Add(-time.Minute).Format("2006-01-02T15:04:05.000Z")

	claim, err := repository.Claim(context.Background(), job)
	if err != nil {
		t.Fatalf("Claim error = %v", err)
	}
	if claim.Kind != auth.Terminal || claim.Status != "expired" {
		t.Fatalf("claim = %+v, want a terminal expired row", claim)
	}
	if status := statusOf(t, pool, job.JobID); status != "expired" {
		t.Errorf("status = %s, want expired", status)
	}
}

func TestRecordRejectedDoesNotOverwriteATerminalRow(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetDeliveries(t, pool)
	repository := auth.NewRepository(pool)
	job := newTestJob(t)

	if _, err := pool.Exec(context.Background(), `
		INSERT INTO auth_email_deliveries (job_id, job_type, status, expires_at)
		VALUES ($1, $2, 'delivered', $3)
	`, job.JobID, job.Type, mustTime(t, job.ExpiresAt)); err != nil {
		t.Fatalf("seed delivery: %v", err)
	}

	if err := repository.RecordRejected(context.Background(), job.JobID, job.Type, "JOB_OTP_INVALID"); err != nil {
		t.Fatalf("RecordRejected error = %v", err)
	}
	if status := statusOf(t, pool, job.JobID); status != "delivered" {
		t.Errorf("status = %s, want delivered", status)
	}
}

func TestRecordRejectedCreatesARowForAnUnknownJob(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetDeliveries(t, pool)
	repository := auth.NewRepository(pool)
	job := newTestJob(t)

	if err := repository.RecordRejected(context.Background(), job.JobID, job.Type, "JOB_JSON_INVALID"); err != nil {
		t.Fatalf("RecordRejected error = %v", err)
	}
	if status := statusOf(t, pool, job.JobID); status != "rejected" {
		t.Errorf("status = %s, want rejected", status)
	}
}

func mustTime(t *testing.T, value string) time.Time {
	t.Helper()
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		t.Fatalf("parse %q: %v", value, err)
	}
	return parsed
}
