package cancellation

import (
	"context"
	"errors"
	"time"

	"github.com/eventa/notification-service/internal/email"
)

// Outcome kinds the consumer reports as the job's metric label and log outcome.
// The cancellation table has no expired state, so there is no expired outcome.
const (
	OutcomeDelivered = "delivered"
	OutcomeDuplicate = "duplicate"
	OutcomeFailed    = "failed"
	OutcomeRejected  = "rejected"
	OutcomeRetry     = "retry"
)

// Outcome is what one delivery attempt resolved to.
type Outcome struct {
	Kind    string
	RetryAt time.Time
}

// AttendeeContactProvider resolves the address the email is sent to.
type AttendeeContactProvider interface {
	GetContact(ctx context.Context, attendeeID string) (string, error)
}

// EventSummaryProvider resolves the event content the email renders.
type EventSummaryProvider interface {
	GetSummary(ctx context.Context, eventID string) (EventSummary, error)
}

// DeliveryStore is the persistence capability the delivery engine needs.
type DeliveryStore interface {
	Claim(ctx context.Context, deliveryID string) (Claim, error)
	MarkDelivered(ctx context.Context, deliveryID, claimToken, providerMessageID string) (bool, error)
	MarkFailed(ctx context.Context, deliveryID, claimToken, failureCode string) (bool, error)
	MarkRetryScheduled(ctx context.Context, deliveryID, claimToken, failureCode string, retryAt time.Time) (bool, error)
	RecordRejected(ctx context.Context, deliveryID, failureCode string) error
}

// Delivery runs the claim, resolve, send and terminal-state half of the
// workflow. Recipient and event content are read at send time, so the durable
// row never holds an address or an email body.
type Delivery struct {
	deliveries DeliveryStore
	contacts   AttendeeContactProvider
	summaries  EventSummaryProvider
	emails     email.Provider
	from       string
}

// NewDelivery wires a delivery engine.
func NewDelivery(deliveries DeliveryStore, contacts AttendeeContactProvider, summaries EventSummaryProvider, emails email.Provider, from string) *Delivery {
	return &Delivery{
		deliveries: deliveries,
		contacts:   contacts,
		summaries:  summaries,
		emails:     emails,
		from:       from,
	}
}

// Deliver claims the job, resolves its content, sends the email, and records
// the resulting state. A busy or terminal claim short-circuits before any
// remote call.
func (d *Delivery) Deliver(ctx context.Context, job Job) (Outcome, error) {
	claim, err := d.deliveries.Claim(ctx, job.DeliveryID)
	if err != nil {
		return Outcome{}, err
	}

	switch claim.Kind {
	case Terminal:
		if claim.Status == OutcomeDelivered {
			return Outcome{Kind: OutcomeDuplicate}, nil
		}
		return Outcome{Kind: claim.Status}, nil
	case Busy:
		return Outcome{Kind: OutcomeRetry, RetryAt: claim.RetryAt}, nil
	}

	outcome, err := d.attempt(ctx, job, claim)
	if err != nil {
		return d.handleFailure(ctx, job, claim, asProviderError(err))
	}
	return outcome, nil
}

// RecordRejected stores the terminal state for a payload the validator refused.
func (d *Delivery) RecordRejected(ctx context.Context, deliveryID, failureCode string) error {
	return d.deliveries.RecordRejected(ctx, deliveryID, failureCode)
}

// attempt performs one full send. Any failure is reported to the caller, which
// decides whether it is terminal or retryable; a state the database refused to
// record becomes the last-resort retry.
func (d *Delivery) attempt(ctx context.Context, job Job, claim Claim) (Outcome, error) {
	recipient, err := d.resolveContact(ctx, claim.AttendeeID)
	if err != nil {
		return Outcome{}, err
	}
	summary, err := d.resolveSummary(ctx, claim.EventID)
	if err != nil {
		return Outcome{}, err
	}
	content, err := Render(summary)
	if err != nil {
		return Outcome{}, err
	}

	result, err := d.emails.Send(ctx, email.Request{
		From:           d.from,
		To:             recipient,
		Subject:        content.Subject,
		HTML:           content.HTML,
		Text:           content.Text,
		IdempotencyKey: job.DeliveryID,
	})
	if err != nil {
		return Outcome{}, err
	}

	recorded, err := d.deliveries.MarkDelivered(ctx, job.DeliveryID, claim.ClaimToken, result.MessageID)
	if err != nil {
		return Outcome{}, err
	}
	if !recorded {
		return d.recoveryRetry(), nil
	}
	return Outcome{Kind: OutcomeDelivered}, nil
}

func (d *Delivery) resolveContact(ctx context.Context, attendeeID string) (string, error) {
	contact, err := d.contacts.GetContact(ctx, attendeeID)
	if err != nil {
		if errors.Is(err, ErrAttendeeContactNotFound) {
			return "", email.NewDeliveryError("ATTENDEE_CONTACT_NOT_FOUND", false)
		}
		return "", email.NewDeliveryError("ATTENDEE_CONTACT_UNAVAILABLE", true)
	}
	return contact, nil
}

func (d *Delivery) resolveSummary(ctx context.Context, eventID string) (EventSummary, error) {
	summary, err := d.summaries.GetSummary(ctx, eventID)
	if err != nil {
		if errors.Is(err, ErrEventSummaryNotFound) {
			return EventSummary{}, email.NewDeliveryError("EVENT_SUMMARY_NOT_FOUND", false)
		}
		return EventSummary{}, email.NewDeliveryError("EVENT_SUMMARY_UNAVAILABLE", true)
	}
	return summary, nil
}

func (d *Delivery) handleFailure(ctx context.Context, job Job, claim Claim, failure *email.DeliveryError) (Outcome, error) {
	if !failure.Retryable || claim.Attempt >= MaxDeliveryAttempts {
		return d.finish(ctx, job, claim, failure.Code)
	}

	index := claim.Attempt - 1
	if index < 0 || index >= len(RetryDelaysMS) {
		return d.finish(ctx, job, claim, "ATTEMPTS_EXHAUSTED")
	}

	retryAt := time.Now().Add(time.Duration(RetryDelaysMS[index]) * time.Millisecond)
	recorded, err := d.deliveries.MarkRetryScheduled(ctx, job.DeliveryID, claim.ClaimToken, failure.Code, retryAt)
	if err != nil {
		return Outcome{}, err
	}
	if recorded {
		return Outcome{Kind: OutcomeRetry, RetryAt: retryAt}, nil
	}
	return d.recoveryRetry(), nil
}

func (d *Delivery) finish(ctx context.Context, job Job, claim Claim, failureCode string) (Outcome, error) {
	recorded, err := d.deliveries.MarkFailed(ctx, job.DeliveryID, claim.ClaimToken, failureCode)
	if err != nil {
		return Outcome{}, err
	}
	if recorded {
		return Outcome{Kind: OutcomeFailed}, nil
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
