package unittest

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/eventa/notification-service/internal/cancellation"
	"github.com/eventa/notification-service/internal/email"
)

type cancelStoreStub struct {
	claim cancellation.Claim

	deliveredResult bool
	failedResult    bool
	scheduledResult bool

	delivered *cancelFailureCall
	failed    *cancelFailureCall
	scheduled *cancelScheduleCall
}

type cancelFailureCall struct {
	deliveryID  string
	claimToken  string
	failureCode string
}

type cancelScheduleCall struct {
	deliveryID  string
	claimToken  string
	failureCode string
	retryAt     time.Time
}

func (s *cancelStoreStub) Claim(_ context.Context, _ string) (cancellation.Claim, error) {
	return s.claim, nil
}

func (s *cancelStoreStub) MarkDelivered(_ context.Context, deliveryID, claimToken, providerMessageID string) (bool, error) {
	s.delivered = &cancelFailureCall{deliveryID: deliveryID, claimToken: claimToken, failureCode: providerMessageID}
	return s.deliveredResult, nil
}

func (s *cancelStoreStub) MarkFailed(_ context.Context, deliveryID, claimToken, failureCode string) (bool, error) {
	s.failed = &cancelFailureCall{deliveryID: deliveryID, claimToken: claimToken, failureCode: failureCode}
	return s.failedResult, nil
}

func (s *cancelStoreStub) MarkRetryScheduled(_ context.Context, deliveryID, claimToken, failureCode string, retryAt time.Time) (bool, error) {
	s.scheduled = &cancelScheduleCall{deliveryID: deliveryID, claimToken: claimToken, failureCode: failureCode, retryAt: retryAt}
	return s.scheduledResult, nil
}

func (s *cancelStoreStub) RecordRejected(_ context.Context, _ string, _ string) error { return nil }

type contactStub struct {
	email string
	err   error
}

func (s *contactStub) GetContact(_ context.Context, _ string) (string, error) {
	return s.email, s.err
}

type summaryStub struct {
	summary cancellation.EventSummary
	err     error
}

func (s *summaryStub) GetSummary(_ context.Context, _ string) (cancellation.EventSummary, error) {
	return s.summary, s.err
}

func cancellationJob() cancellation.Job {
	return cancellation.Job{DeliveryID: cancelDeliveryID, Type: "notification.event-cancellation-email.v1"}
}

func fullyWiredCancellation(store *cancelStoreStub, provider *providerStub) *cancellation.Delivery {
	return cancellation.NewDelivery(
		store,
		&contactStub{email: "attendee@example.com"},
		&summaryStub{summary: riverlightSummary()},
		provider,
		"Eventa <noreply@livepoly.site>",
	)
}

func TestClaimedCancellationSendsTheRenderedEmailAndRecordsDelivered(t *testing.T) {
	store := &cancelStoreStub{
		claim:           cancellation.Claim{Kind: cancellation.Claimed, Attempt: 1, ClaimToken: "token-1"},
		deliveredResult: true,
	}
	provider := &providerStub{result: email.Result{MessageID: "provider-1"}}
	delivery := fullyWiredCancellation(store, provider)

	outcome, err := delivery.Deliver(context.Background(), cancellationJob())
	if err != nil {
		t.Fatalf("Deliver error = %v", err)
	}
	if outcome.Kind != cancellation.OutcomeDelivered {
		t.Errorf("outcome = %s, want %s", outcome.Kind, cancellation.OutcomeDelivered)
	}
	if len(provider.requests) != 1 {
		t.Fatalf("provider calls = %d, want 1", len(provider.requests))
	}

	request := provider.requests[0]
	if request.Subject != "Riverlight Festival has been cancelled" {
		t.Errorf("subject = %q, want the cancellation subject", request.Subject)
	}
	if request.To != "attendee@example.com" {
		t.Errorf("To = %s, want attendee@example.com", request.To)
	}
	if request.IdempotencyKey != cancelDeliveryID {
		t.Errorf("IdempotencyKey = %s, want %s", request.IdempotencyKey, cancelDeliveryID)
	}
	if !strings.Contains(request.Text, "Parque das Nações, Lisbon") {
		t.Errorf("text = %q, want the venue", request.Text)
	}
	if store.delivered == nil {
		t.Fatal("MarkDelivered was not called")
	}
	if store.delivered.failureCode != "provider-1" {
		t.Errorf("provider message id = %s, want provider-1", store.delivered.failureCode)
	}
	if store.delivered.claimToken != "token-1" {
		t.Errorf("claim token = %s, want token-1", store.delivered.claimToken)
	}
}

func TestTerminalDeliveredCancellationClaimIsADuplicateWithoutCallingTheProvider(t *testing.T) {
	store := &cancelStoreStub{claim: cancellation.Claim{Kind: cancellation.Terminal, Status: "delivered"}}
	provider := &providerStub{}
	delivery := fullyWiredCancellation(store, provider)

	outcome, err := delivery.Deliver(context.Background(), cancellationJob())
	if err != nil {
		t.Fatalf("Deliver error = %v", err)
	}
	if outcome.Kind != cancellation.OutcomeDuplicate {
		t.Errorf("outcome = %s, want %s", outcome.Kind, cancellation.OutcomeDuplicate)
	}
	if len(provider.requests) != 0 {
		t.Errorf("provider calls = %d, want 0", len(provider.requests))
	}
}

func TestBusyCancellationClaimReturnsRetryWithoutCallingTheProvider(t *testing.T) {
	retryAt := time.Now().UTC().Add(12 * time.Second)
	store := &cancelStoreStub{claim: cancellation.Claim{Kind: cancellation.Busy, RetryAt: retryAt}}
	provider := &providerStub{}
	delivery := fullyWiredCancellation(store, provider)

	outcome, err := delivery.Deliver(context.Background(), cancellationJob())
	if err != nil {
		t.Fatalf("Deliver error = %v", err)
	}
	if outcome.Kind != cancellation.OutcomeRetry {
		t.Errorf("outcome = %s, want %s", outcome.Kind, cancellation.OutcomeRetry)
	}
	if !outcome.RetryAt.Equal(retryAt) {
		t.Errorf("RetryAt = %v, want %v", outcome.RetryAt, retryAt)
	}
	if len(provider.requests) != 0 {
		t.Errorf("provider calls = %d, want 0", len(provider.requests))
	}
	if store.scheduled != nil {
		t.Error("a busy claim wrote next_attempt_at")
	}
}

func TestMissingAttendeeFailsTheCancellationDeliveryPermanently(t *testing.T) {
	store := &cancelStoreStub{
		claim:        cancellation.Claim{Kind: cancellation.Claimed, Attempt: 1, ClaimToken: "token-1"},
		failedResult: true,
	}
	provider := &providerStub{}
	delivery := cancellation.NewDelivery(store,
		&contactStub{err: cancellation.ErrAttendeeContactNotFound},
		&summaryStub{summary: riverlightSummary()},
		provider, "Eventa <noreply@livepoly.site>")

	outcome, err := delivery.Deliver(context.Background(), cancellationJob())
	if err != nil {
		t.Fatalf("Deliver error = %v", err)
	}
	if outcome.Kind != cancellation.OutcomeFailed {
		t.Errorf("outcome = %s, want %s", outcome.Kind, cancellation.OutcomeFailed)
	}
	if store.failed == nil || store.failed.failureCode != "ATTENDEE_CONTACT_NOT_FOUND" {
		t.Errorf("failure = %+v, want ATTENDEE_CONTACT_NOT_FOUND", store.failed)
	}
	if len(provider.requests) != 0 {
		t.Errorf("provider calls = %d, want 0", len(provider.requests))
	}
}

func TestUnavailableAttendeeLookupSchedulesACancellationRetry(t *testing.T) {
	store := &cancelStoreStub{
		claim:           cancellation.Claim{Kind: cancellation.Claimed, Attempt: 1, ClaimToken: "token-1"},
		scheduledResult: true,
	}
	provider := &providerStub{}
	delivery := cancellation.NewDelivery(store,
		&contactStub{err: errors.New("identity unavailable")},
		&summaryStub{summary: riverlightSummary()},
		provider, "Eventa <noreply@livepoly.site>")

	outcome, err := delivery.Deliver(context.Background(), cancellationJob())
	if err != nil {
		t.Fatalf("Deliver error = %v", err)
	}
	if outcome.Kind != cancellation.OutcomeRetry {
		t.Errorf("outcome = %s, want %s", outcome.Kind, cancellation.OutcomeRetry)
	}
	if store.scheduled == nil || store.scheduled.failureCode != "ATTENDEE_CONTACT_UNAVAILABLE" {
		t.Errorf("schedule = %+v, want ATTENDEE_CONTACT_UNAVAILABLE", store.scheduled)
	}
}

func TestMissingEventFailsTheCancellationDeliveryPermanently(t *testing.T) {
	store := &cancelStoreStub{
		claim:        cancellation.Claim{Kind: cancellation.Claimed, Attempt: 1, ClaimToken: "token-1"},
		failedResult: true,
	}
	provider := &providerStub{}
	delivery := cancellation.NewDelivery(store,
		&contactStub{email: "attendee@example.com"},
		&summaryStub{err: cancellation.ErrEventSummaryNotFound},
		provider, "Eventa <noreply@livepoly.site>")

	outcome, err := delivery.Deliver(context.Background(), cancellationJob())
	if err != nil {
		t.Fatalf("Deliver error = %v", err)
	}
	if outcome.Kind != cancellation.OutcomeFailed {
		t.Errorf("outcome = %s, want %s", outcome.Kind, cancellation.OutcomeFailed)
	}
	if store.failed == nil || store.failed.failureCode != "EVENT_SUMMARY_NOT_FOUND" {
		t.Errorf("failure = %+v, want EVENT_SUMMARY_NOT_FOUND", store.failed)
	}
}

func TestUnavailableEventLookupSchedulesACancellationRetry(t *testing.T) {
	store := &cancelStoreStub{
		claim:           cancellation.Claim{Kind: cancellation.Claimed, Attempt: 1, ClaimToken: "token-1"},
		scheduledResult: true,
	}
	provider := &providerStub{}
	delivery := cancellation.NewDelivery(store,
		&contactStub{email: "attendee@example.com"},
		&summaryStub{err: errors.New("event unavailable")},
		provider, "Eventa <noreply@livepoly.site>")

	outcome, err := delivery.Deliver(context.Background(), cancellationJob())
	if err != nil {
		t.Fatalf("Deliver error = %v", err)
	}
	if outcome.Kind != cancellation.OutcomeRetry {
		t.Errorf("outcome = %s, want %s", outcome.Kind, cancellation.OutcomeRetry)
	}
	if store.scheduled == nil || store.scheduled.failureCode != "EVENT_SUMMARY_UNAVAILABLE" {
		t.Errorf("schedule = %+v, want EVENT_SUMMARY_UNAVAILABLE", store.scheduled)
	}
}

func TestPermanentProviderErrorFailsTheCancellationDelivery(t *testing.T) {
	store := &cancelStoreStub{
		claim:        cancellation.Claim{Kind: cancellation.Claimed, Attempt: 1, ClaimToken: "token-1"},
		failedResult: true,
	}
	provider := &providerStub{err: email.NewDeliveryError(email.CodeProviderIdempotencySerial, false)}
	delivery := fullyWiredCancellation(store, provider)

	outcome, err := delivery.Deliver(context.Background(), cancellationJob())
	if err != nil {
		t.Fatalf("Deliver error = %v", err)
	}
	if outcome.Kind != cancellation.OutcomeFailed {
		t.Errorf("outcome = %s, want %s", outcome.Kind, cancellation.OutcomeFailed)
	}
	if store.failed == nil || store.failed.failureCode != email.CodeProviderIdempotencySerial {
		t.Errorf("failure = %+v, want %s", store.failed, email.CodeProviderIdempotencySerial)
	}
	if store.scheduled != nil {
		t.Error("MarkRetryScheduled was called for a permanent error")
	}
}

func TestThirdCancellationAttemptFailsInsteadOfSchedulingAnotherRetry(t *testing.T) {
	store := &cancelStoreStub{
		claim:        cancellation.Claim{Kind: cancellation.Claimed, Attempt: cancellation.MaxDeliveryAttempts, ClaimToken: "token-3"},
		failedResult: true,
	}
	provider := &providerStub{err: email.NewDeliveryError(email.CodeProviderTimeout, true)}
	delivery := fullyWiredCancellation(store, provider)

	outcome, err := delivery.Deliver(context.Background(), cancellationJob())
	if err != nil {
		t.Fatalf("Deliver error = %v", err)
	}
	if outcome.Kind != cancellation.OutcomeFailed {
		t.Errorf("outcome = %s, want %s", outcome.Kind, cancellation.OutcomeFailed)
	}
	if store.scheduled != nil {
		t.Error("MarkRetryScheduled was called on the final attempt")
	}
	if store.failed == nil || store.failed.failureCode != email.CodeProviderTimeout {
		t.Errorf("failure = %+v, want %s", store.failed, email.CodeProviderTimeout)
	}
}

func TestLostCancellationClaimRecoversOnTheLongestRetryDelay(t *testing.T) {
	store := &cancelStoreStub{
		claim:           cancellation.Claim{Kind: cancellation.Claimed, Attempt: 1, ClaimToken: "token-1"},
		deliveredResult: false,
	}
	provider := &providerStub{result: email.Result{MessageID: "provider-1"}}
	delivery := fullyWiredCancellation(store, provider)

	outcome, err := delivery.Deliver(context.Background(), cancellationJob())
	if err != nil {
		t.Fatalf("Deliver error = %v", err)
	}
	if outcome.Kind != cancellation.OutcomeRetry {
		t.Errorf("outcome = %s, want %s", outcome.Kind, cancellation.OutcomeRetry)
	}
	lastDelay := time.Duration(cancellation.RetryDelaysMS[len(cancellation.RetryDelaysMS)-1]) * time.Millisecond
	if delay := time.Until(outcome.RetryAt); delay <= 0 || delay > lastDelay+time.Second {
		t.Errorf("recovery delay = %v, want at most %v", delay, lastDelay)
	}
}
