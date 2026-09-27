// Package email holds the outbound-mail contract the notification service
// depends on. Vendor-specific behaviour stays behind Provider.
package email

import "context"

// Request is one message ready to hand to a provider.
type Request struct {
	From           string
	To             string
	Subject        string
	HTML           string
	Text           string
	IdempotencyKey string
}

// Result is the provider's acknowledgement of one accepted message.
type Result struct {
	MessageID string
}

// Provider sends one message. Implementations translate their own failures
// into *DeliveryError so the delivery engine can decide retry policy from the
// code and the retryable flag.
type Provider interface {
	Send(ctx context.Context, request Request) (Result, error)
}
