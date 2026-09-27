package auth

import (
	"context"
	"errors"
	"time"

	"github.com/eventa/notification-service/internal/email"
)

// Outcome kinds the consumer reports as the job's metric label and log outcome.
const (
	OutcomeDelivered = "delivered"
	OutcomeDuplicate = "duplicate"
	OutcomeExpired   = "expired"
	OutcomeFailed    = "failed"
	OutcomeRejected  = "rejected"
	OutcomeRetry     = "retry"
)

// Outcome is what one delivery attempt resolved to.
type Outcome struct {
	Kind    string
	RetryAt time.Time
}

// DeliveryStore is the persistence capability the delivery engine needs. The
// repository owns the real state machine; tests substitute their own.
type DeliveryStore interface {
	Claim(ctx context.Context, job Job) (Claim, error)
	MarkDelivered(ctx context.Context, jobID, claimToken, providerMessageID string) (bool, error)
	MarkExpired(ctx context.Context, jobID, claimToken string) (bool, error)
	MarkFailed(ctx context.Context, jobID, claimToken, failureCode string) (bool, error)
	MarkRetryScheduled(ctx context.Context, jobID, claimToken, failureCode string, retryAt time.Time) (bool, error)
	RecordRejected(ctx context.Context, jobID, jobType, failureCode string) error
}

// Delivery runs the claim, send and terminal-state half of the workflow for one
// Definition.
type Delivery struct {
	definition Definition
	deliveries DeliveryStore
	emails     email.Provider
	from       string
}

// NewDelivery wires a delivery engine for one job definition.
func NewDelivery(definition Definition, deliveries DeliveryStore, emails email.Provider, from string) *Delivery {
	return &Delivery{definition: definition, deliveries: deliveries, emails: emails, from: from}
}

// Deliver claims the job, sends the code, and records the resulting state. A
// busy or terminal claim short-circuits before any provider call.
func (d *Delivery) Deliver(ctx context.Context, job Job) (Outcome, error) {
	claim, err := d.deliveries.Claim(ctx, job)
	if err != nil {
		return Outcome{}, err
	}

	switch claim.Kind {
	case Terminal:
		if claim.Status == OutcomeDelivered {
			return Outcome{Kind: OutcomeDuplicate}, nil
		}
		return Outcome{Kind: claim.Status}, nil
	case Conflict:
		return Outcome{Kind: OutcomeRejected}, nil
	case Busy:
		return Outcome{Kind: OutcomeRetry, RetryAt: claim.RetryAt}, nil
	}

	content := d.definition.Template(job.Secret)
	result, sendErr := d.emails.Send(ctx, email.Request{
		From:           d.from,
		To:             job.RecipientEmail,
		Subject:        content.Subject,
		HTML:           content.HTML,
		Text:           content.Text,
		IdempotencyKey: job.JobID,
	})
	if sendErr == nil {
		recorded, recordErr := d.deliveries.MarkDelivered(ctx, job.JobID, claim.ClaimToken, result.MessageID)
		if recordErr != nil {
			return Outcome{}, recordErr
		}
		if recorded {
			return Outcome{Kind: OutcomeDelivered}, nil
		}
		return d.recoveryRetry(), nil
	}

	return d.handleFailure(ctx, job, claim, asProviderError(sendErr))
}

// RecordRejected stores the terminal state for a payload the validator refused.
func (d *Delivery) RecordRejected(ctx context.Context, jobID, failureCode string) error {
	return d.deliveries.RecordRejected(ctx, jobID, d.definition.JobType, failureCode)
}

func (d *Delivery) handleFailure(ctx context.Context, job Job, claim Claim, failure *email.DeliveryError) (Outcome, error) {
	if !failure.Retryable || claim.Attempt >= MaxDeliveryAttempts {
		recorded, err := d.deliveries.MarkFailed(ctx, job.JobID, claim.ClaimToken, failure.Code)
		if err != nil {
			return Outcome{}, err
		}
		if recorded {
			return Outcome{Kind: OutcomeFailed}, nil
		}
		return d.recoveryRetry(), nil
	}

	index := claim.Attempt - 1
	if index < 0 || index >= len(RetryDelaysMS) {
		recorded, err := d.deliveries.MarkFailed(ctx, job.JobID, claim.ClaimToken, "ATTEMPTS_EXHAUSTED")
		if err != nil {
			return Outcome{}, err
		}
		if recorded {
			return Outcome{Kind: OutcomeFailed}, nil
		}
		return d.recoveryRetry(), nil
	}

	retryAt := time.Now().Add(time.Duration(RetryDelaysMS[index]) * time.Millisecond)

	expiresAt, err := time.Parse(time.RFC3339Nano, job.ExpiresAt)
	if err != nil {
		return Outcome{}, err
	}
	if !retryAt.Before(expiresAt) {
		recorded, err := d.deliveries.MarkExpired(ctx, job.JobID, claim.ClaimToken)
		if err != nil {
			return Outcome{}, err
		}
		if recorded {
			return Outcome{Kind: OutcomeExpired}, nil
		}
		return d.recoveryRetry(), nil
	}

	recorded, err := d.deliveries.MarkRetryScheduled(ctx, job.JobID, claim.ClaimToken, failure.Code, retryAt)
	if err != nil {
		return Outcome{}, err
	}
	if recorded {
		return Outcome{Kind: OutcomeRetry, RetryAt: retryAt}, nil
	}
	return d.recoveryRetry(), nil
}

// recoveryRetry is the last-resort wait used when the database refuses to
// record an outcome, so the broker retries instead of dropping the job.
func (d *Delivery) recoveryRetry() Outcome {
	return Outcome{
		Kind:    OutcomeRetry,
		RetryAt: time.Now().Add(time.Duration(RetryDelaysMS[len(RetryDelaysMS)-1]) * time.Millisecond),
	}
}

// asProviderError maps any send failure onto the provider failure contract, so
// an unexpected error is treated as a retryable outage exactly as before.
func asProviderError(err error) *email.DeliveryError {
	var deliveryError *email.DeliveryError
	if errors.As(err, &deliveryError) {
		return deliveryError
	}
	return email.NewDeliveryError(email.CodeProviderUnavailable, true)
}
