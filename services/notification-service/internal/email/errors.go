package email

// Failure codes reported to the delivery engine. Retryable codes re-enter the
// retry ladder; non-retryable codes finish the delivery as failed.
const (
	CodeProviderTimeout           = "EMAIL_PROVIDER_TIMEOUT"
	CodeProviderUnavailable       = "EMAIL_PROVIDER_UNAVAILABLE"
	CodeProviderRateLimited       = "EMAIL_PROVIDER_RATE_LIMITED"
	CodeProviderRequestRejected   = "EMAIL_PROVIDER_REQUEST_REJECTED"
	CodeProviderInvalidResponse   = "EMAIL_PROVIDER_INVALID_RESPONSE"
	CodeProviderIdempotencySerial = "EMAIL_PROVIDER_IDEMPOTENCY_CONFLICT"
	CodeProviderIdempotencyBusy   = "EMAIL_PROVIDER_IDEMPOTENCY_CONCURRENT"
)

// DeliveryError carries a provider failure with the two facts the delivery
// engine needs: a stable code and whether another attempt can succeed.
type DeliveryError struct {
	Code      string
	Retryable bool
}

func (e *DeliveryError) Error() string { return e.Code }

// Name matches the `error.name` the TypeScript telemetry read.
func (e *DeliveryError) Name() string { return "EmailDeliveryError" }

// NewDeliveryError builds a provider failure.
func NewDeliveryError(code string, retryable bool) *DeliveryError {
	return &DeliveryError{Code: code, Retryable: retryable}
}
