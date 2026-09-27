package unittest

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/eventa/notification-service/internal/auth"
	"github.com/eventa/notification-service/internal/email"
)

type storeStub struct {
	claim auth.Claim

	deliveredResult  bool
	failedResult     bool
	expiredResult    bool
	scheduledResult  bool
	recordRejectedOK error

	claimedJob   auth.Job
	delivered    *deliveredCall
	failed       *failureCall
	scheduled    *scheduleCall
	expiredCalls int
	rejected     *rejectedCall
}

type deliveredCall struct {
	jobID      string
	claimToken string
	providerID string
}

type failureCall struct {
	jobID       string
	claimToken  string
	failureCode string
}

type scheduleCall struct {
	jobID       string
	claimToken  string
	failureCode string
	retryAt     time.Time
}

type rejectedCall struct {
	jobID       string
	jobType     string
	failureCode string
}

func (s *storeStub) Claim(_ context.Context, job auth.Job) (auth.Claim, error) {
	s.claimedJob = job
	return s.claim, nil
}

func (s *storeStub) MarkDelivered(_ context.Context, jobID, claimToken, providerMessageID string) (bool, error) {
	s.delivered = &deliveredCall{jobID: jobID, claimToken: claimToken, providerID: providerMessageID}
	return s.deliveredResult, nil
}

func (s *storeStub) MarkExpired(context.Context, string, string) (bool, error) {
	s.expiredCalls++
	return s.expiredResult, nil
}

func (s *storeStub) MarkFailed(_ context.Context, jobID, claimToken, failureCode string) (bool, error) {
	s.failed = &failureCall{jobID: jobID, claimToken: claimToken, failureCode: failureCode}
	return s.failedResult, nil
}

func (s *storeStub) MarkRetryScheduled(_ context.Context, jobID, claimToken, failureCode string, retryAt time.Time) (bool, error) {
	s.scheduled = &scheduleCall{jobID: jobID, claimToken: claimToken, failureCode: failureCode, retryAt: retryAt}
	return s.scheduledResult, nil
}

func (s *storeStub) RecordRejected(_ context.Context, jobID, jobType, failureCode string) error {
	s.rejected = &rejectedCall{jobID: jobID, jobType: jobType, failureCode: failureCode}
	return s.recordRejectedOK
}

type providerStub struct {
	requests []email.Request
	result   email.Result
	err      error
}

func (p *providerStub) Send(_ context.Context, request email.Request) (email.Result, error) {
	p.requests = append(p.requests, request)
	return p.result, p.err
}

func verificationJob() auth.Job {
	return auth.Job{
		JobID:          jobID,
		Type:           "attendee.email-verification.v1",
		RecipientEmail: "attendee@example.com",
		ExpiresAt:      time.Now().UTC().Add(time.Hour).Format("2006-01-02T15:04:05.000Z"),
		Secret:         "123456",
	}
}

func newDelivery(t *testing.T, store *storeStub, provider *providerStub) *auth.Delivery {
	t.Helper()
	definition := definitionFor(t, "attendee.email-verification.v1")
	return auth.NewDelivery(definition, store, provider, "Eventa <noreply@livepoly.site>")
}

func TestClaimedDeliverySendsTheRenderedCodeAndRecordsDelivered(t *testing.T) {
	store := &storeStub{
		claim:           auth.Claim{Kind: auth.Claimed, Attempt: 1, ClaimToken: "token-1"},
		deliveredResult: true,
	}
	provider := &providerStub{result: email.Result{MessageID: "provider-1"}}
	delivery := newDelivery(t, store, provider)

	outcome, err := delivery.Deliver(context.Background(), verificationJob())
	if err != nil {
		t.Fatalf("Deliver error = %v", err)
	}
	if outcome.Kind != auth.OutcomeDelivered {
		t.Errorf("outcome = %s, want %s", outcome.Kind, auth.OutcomeDelivered)
	}
	if len(provider.requests) != 1 {
		t.Fatalf("provider calls = %d, want 1", len(provider.requests))
	}

	request := provider.requests[0]
	if request.From != "Eventa <noreply@livepoly.site>" {
		t.Errorf("From = %s, want the configured sender", request.From)
	}
	if request.To != "attendee@example.com" {
		t.Errorf("To = %s, want attendee@example.com", request.To)
	}
	if request.IdempotencyKey != jobID {
		t.Errorf("IdempotencyKey = %s, want %s", request.IdempotencyKey, jobID)
	}
	if request.Subject != "Verify your Eventa email" {
		t.Errorf("Subject = %q, want %q", request.Subject, "Verify your Eventa email")
	}
	if want := "123456"; !strings.Contains(request.HTML, want) || !strings.Contains(request.Text, want) {
		t.Errorf("message body does not carry the code")
	}
	if store.delivered == nil {
		t.Fatal("MarkDelivered was not called")
	}
	if store.delivered.providerID != "provider-1" {
		t.Errorf("provider message id = %s, want provider-1", store.delivered.providerID)
	}
	if store.delivered.claimToken != "token-1" {
		t.Errorf("claim token = %s, want token-1", store.delivered.claimToken)
	}
}

func TestTerminalDeliveredClaimIsADuplicateWithoutCallingTheProvider(t *testing.T) {
	store := &storeStub{claim: auth.Claim{Kind: auth.Terminal, Status: "delivered"}}
	provider := &providerStub{}
	delivery := newDelivery(t, store, provider)

	outcome, err := delivery.Deliver(context.Background(), verificationJob())
	if err != nil {
		t.Fatalf("Deliver error = %v", err)
	}
	if outcome.Kind != auth.OutcomeDuplicate {
		t.Errorf("outcome = %s, want %s", outcome.Kind, auth.OutcomeDuplicate)
	}
	if len(provider.requests) != 0 {
		t.Errorf("provider calls = %d, want 0", len(provider.requests))
	}
	if store.delivered != nil {
		t.Error("MarkDelivered was called for a terminal claim")
	}
}

func TestBusyClaimReturnsRetryWithoutCallingTheProvider(t *testing.T) {
	retryAt := time.Now().UTC().Add(12 * time.Second)
	store := &storeStub{claim: auth.Claim{Kind: auth.Busy, RetryAt: retryAt}}
	provider := &providerStub{}
	delivery := newDelivery(t, store, provider)

	outcome, err := delivery.Deliver(context.Background(), verificationJob())
	if err != nil {
		t.Fatalf("Deliver error = %v", err)
	}
	if outcome.Kind != auth.OutcomeRetry {
		t.Errorf("outcome = %s, want %s", outcome.Kind, auth.OutcomeRetry)
	}
	if !outcome.RetryAt.Equal(retryAt) {
		t.Errorf("RetryAt = %v, want %v", outcome.RetryAt, retryAt)
	}
	if len(provider.requests) != 0 {
		t.Errorf("provider calls = %d, want 0", len(provider.requests))
	}
}

func TestRetryableProviderErrorSchedulesTheNextAttemptWithItsCode(t *testing.T) {
	store := &storeStub{
		claim:           auth.Claim{Kind: auth.Claimed, Attempt: 1, ClaimToken: "token-1"},
		scheduledResult: true,
	}
	provider := &providerStub{err: email.NewDeliveryError(email.CodeProviderRateLimited, true)}
	delivery := newDelivery(t, store, provider)

	outcome, err := delivery.Deliver(context.Background(), verificationJob())
	if err != nil {
		t.Fatalf("Deliver error = %v", err)
	}
	if outcome.Kind != auth.OutcomeRetry {
		t.Errorf("outcome = %s, want %s", outcome.Kind, auth.OutcomeRetry)
	}
	if store.scheduled == nil {
		t.Fatal("MarkRetryScheduled was not called")
	}
	if store.scheduled.failureCode != email.CodeProviderRateLimited {
		t.Errorf("failure code = %s, want %s", store.scheduled.failureCode, email.CodeProviderRateLimited)
	}
	wantDelay := time.Duration(auth.RetryDelaysMS[0]) * time.Millisecond
	if delay := time.Until(store.scheduled.retryAt); delay > wantDelay+time.Second {
		t.Errorf("retry delay = %v, want about %v", delay, wantDelay)
	}
	if store.failed != nil {
		t.Error("MarkFailed was called for a retryable error")
	}
}

func TestPermanentProviderErrorFailsTheDelivery(t *testing.T) {
	store := &storeStub{
		claim:        auth.Claim{Kind: auth.Claimed, Attempt: 1, ClaimToken: "token-1"},
		failedResult: true,
	}
	provider := &providerStub{err: email.NewDeliveryError(email.CodeProviderIdempotencySerial, false)}
	delivery := newDelivery(t, store, provider)

	outcome, err := delivery.Deliver(context.Background(), verificationJob())
	if err != nil {
		t.Fatalf("Deliver error = %v", err)
	}
	if outcome.Kind != auth.OutcomeFailed {
		t.Errorf("outcome = %s, want %s", outcome.Kind, auth.OutcomeFailed)
	}
	if store.failed == nil {
		t.Fatal("MarkFailed was not called")
	}
	if store.failed.failureCode != email.CodeProviderIdempotencySerial {
		t.Errorf("failure code = %s, want %s", store.failed.failureCode, email.CodeProviderIdempotencySerial)
	}
	if store.scheduled != nil {
		t.Error("MarkRetryScheduled was called for a permanent error")
	}
}

func TestThirdAttemptFailsInsteadOfSchedulingAnotherRetry(t *testing.T) {
	store := &storeStub{
		claim:        auth.Claim{Kind: auth.Claimed, Attempt: auth.MaxDeliveryAttempts, ClaimToken: "token-3"},
		failedResult: true,
	}
	provider := &providerStub{err: email.NewDeliveryError(email.CodeProviderTimeout, true)}
	delivery := newDelivery(t, store, provider)

	outcome, err := delivery.Deliver(context.Background(), verificationJob())
	if err != nil {
		t.Fatalf("Deliver error = %v", err)
	}
	if outcome.Kind != auth.OutcomeFailed {
		t.Errorf("outcome = %s, want %s", outcome.Kind, auth.OutcomeFailed)
	}
	if store.scheduled != nil {
		t.Error("MarkRetryScheduled was called on the final attempt")
	}
	if store.failed == nil {
		t.Fatal("MarkFailed was not called")
	}
	if store.failed.failureCode != email.CodeProviderTimeout {
		t.Errorf("failure code = %s, want %s", store.failed.failureCode, email.CodeProviderTimeout)
	}
}

func TestLostClaimRecoversOnTheLongestRetryDelay(t *testing.T) {
	store := &storeStub{
		claim:           auth.Claim{Kind: auth.Claimed, Attempt: 1, ClaimToken: "token-1"},
		deliveredResult: false,
	}
	provider := &providerStub{result: email.Result{MessageID: "provider-1"}}
	delivery := newDelivery(t, store, provider)

	outcome, err := delivery.Deliver(context.Background(), verificationJob())
	if err != nil {
		t.Fatalf("Deliver error = %v", err)
	}
	if outcome.Kind != auth.OutcomeRetry {
		t.Errorf("outcome = %s, want %s", outcome.Kind, auth.OutcomeRetry)
	}
	lastDelay := time.Duration(auth.RetryDelaysMS[len(auth.RetryDelaysMS)-1]) * time.Millisecond
	if delay := time.Until(outcome.RetryAt); delay <= 0 || delay > lastDelay+time.Second {
		t.Errorf("recovery delay = %v, want at most %v", delay, lastDelay)
	}
}

func TestRetryScheduledAfterExpiryBecomesExpired(t *testing.T) {
	store := &storeStub{
		claim:         auth.Claim{Kind: auth.Claimed, Attempt: 2, ClaimToken: "token-1"},
		expiredResult: true,
	}
	provider := &providerStub{err: email.NewDeliveryError(email.CodeProviderUnavailable, true)}
	delivery := newDelivery(t, store, provider)

	job := verificationJob()
	job.ExpiresAt = time.Now().UTC().Add(time.Second).Format("2006-01-02T15:04:05.000Z")

	outcome, err := delivery.Deliver(context.Background(), job)
	if err != nil {
		t.Fatalf("Deliver error = %v", err)
	}
	if outcome.Kind != auth.OutcomeExpired {
		t.Errorf("outcome = %s, want %s", outcome.Kind, auth.OutcomeExpired)
	}
	if store.expiredCalls != 1 {
		t.Errorf("MarkExpired calls = %d, want 1", store.expiredCalls)
	}
	if store.scheduled != nil {
		t.Error("MarkRetryScheduled was called past the job expiry")
	}
}

func TestUnrecognisedProviderFailureIsTreatedAsARetryableOutage(t *testing.T) {
	store := &storeStub{
		claim:           auth.Claim{Kind: auth.Claimed, Attempt: 1, ClaimToken: "token-1"},
		scheduledResult: true,
	}
	provider := &providerStub{err: errors.New("connection reset")}
	delivery := newDelivery(t, store, provider)

	outcome, err := delivery.Deliver(context.Background(), verificationJob())
	if err != nil {
		t.Fatalf("Deliver error = %v", err)
	}
	if outcome.Kind != auth.OutcomeRetry {
		t.Errorf("outcome = %s, want %s", outcome.Kind, auth.OutcomeRetry)
	}
	if store.scheduled == nil {
		t.Fatal("MarkRetryScheduled was not called")
	}
	if store.scheduled.failureCode != email.CodeProviderUnavailable {
		t.Errorf("failure code = %s, want %s", store.scheduled.failureCode, email.CodeProviderUnavailable)
	}
}

func TestRecordRejectedUsesTheDefinitionJobType(t *testing.T) {
	store := &storeStub{}
	provider := &providerStub{}
	delivery := newDelivery(t, store, provider)

	if err := delivery.RecordRejected(context.Background(), jobID, "JOB_OTP_INVALID"); err != nil {
		t.Fatalf("RecordRejected error = %v", err)
	}
	if store.rejected == nil {
		t.Fatal("RecordRejected was not called")
	}
	if store.rejected.jobType != "attendee.email-verification.v1" {
		t.Errorf("job type = %s, want attendee.email-verification.v1", store.rejected.jobType)
	}
	if store.rejected.failureCode != "JOB_OTP_INVALID" {
		t.Errorf("failure code = %s, want JOB_OTP_INVALID", store.rejected.failureCode)
	}
}
