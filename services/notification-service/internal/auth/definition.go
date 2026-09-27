// Package auth delivers the four one-time-code emails Identity assigns to the
// notification service: email verification, attendee password reset, admin
// activation and admin password reset. All four run through one consumer,
// one validator and one delivery engine parameterised by a Definition, so the
// behavioural differences between them are data rather than code.
package auth

// Delivery policy shared by every auth job.
const (
	MaxDeliveryAttempts = 3
	ProcessingLeaseMS   = 30_000
)

// RetryDelaysMS is the retry ladder: attempt n waits the nth entry before the
// broker releases the retry copy.
var RetryDelaysMS = []int{5_000, 30_000}

// SecretField names the payload field that carries the one-time code.
type SecretField string

const (
	SecretOTP  SecretField = "otp"
	SecretCode SecretField = "code"
)

// Content is the rendered message the provider sends.
type Content struct {
	Subject string
	HTML    string
	Text    string
}

// Definition is everything that differs between the four auth jobs.
type Definition struct {
	Queue   string
	JobType string
	// Context is the emitting class name recorded in the log envelope.
	Context               string
	Operation             string
	EventPrefix           string
	ConsumerPurpose       string
	RetryPublisherPurpose string
	MaxBytes              int
	Secret                SecretField
	Template              func(secret string) Content
}

// SecretKey is the payload field that carries the one-time code.
func (d Definition) SecretKey() string { return string(d.Secret) }

// SecretFailureCode is the validator's failure code for a malformed code.
func (d Definition) SecretFailureCode() string {
	if d.Secret == SecretCode {
		return "JOB_CODE_INVALID"
	}
	return "JOB_OTP_INVALID"
}

// Job is one validated auth job.
type Job struct {
	JobID          string
	Type           string
	RecipientEmail string
	ExpiresAt      string
	Secret         string
}

// Definitions returns the four consumers the service runs, in a fixed order.
func Definitions() []Definition {
	return []Definition{
		attendeeEmailVerification(),
		attendeePasswordReset(),
		adminActivation(),
		adminPasswordReset(),
	}
}

func attendeeEmailVerification() Definition {
	return Definition{
		Context:               "EmailVerificationJobConsumer",
		Queue:                 "eventa.notification.attendee-email-verification.v1",
		JobType:               "attendee.email-verification.v1",
		Operation:             "attendee.email_verification.delivery",
		EventPrefix:           "email_verification",
		ConsumerPurpose:       "email-verification-job-consumer",
		RetryPublisherPurpose: "email-verification-retry-publisher",
		MaxBytes:              2_048,
		Secret:                SecretOTP,
		Template:              AttendeeEmailVerificationTemplate,
	}
}

func attendeePasswordReset() Definition {
	return Definition{
		Context:               "PasswordResetJobConsumer",
		Queue:                 "eventa.notification.attendee-password-reset.v1",
		JobType:               "attendee.password-reset.v1",
		Operation:             "attendee.password_reset.delivery",
		EventPrefix:           "password_reset",
		ConsumerPurpose:       "attendee.password-reset.v1-consumer",
		RetryPublisherPurpose: "attendee.password-reset.v1-retry-publisher",
		MaxBytes:              4_096,
		Secret:                SecretCode,
		Template:              AttendeePasswordResetTemplate,
	}
}

func adminActivation() Definition {
	return Definition{
		Context:               "AdminActivationJobConsumer",
		Queue:                 "eventa.notification.admin-activation.v1",
		JobType:               "admin.activation.v1",
		Operation:             "admin.activation.delivery",
		EventPrefix:           "admin_activation",
		ConsumerPurpose:       "admin-activation-job-consumer",
		RetryPublisherPurpose: "admin-activation-retry-publisher",
		MaxBytes:              4_096,
		Secret:                SecretOTP,
		Template:              AdminActivationTemplate,
	}
}

func adminPasswordReset() Definition {
	return Definition{
		Context:               "PasswordResetJobConsumer",
		Queue:                 "eventa.notification.admin-password-reset.v1",
		JobType:               "admin.password-reset.v1",
		Operation:             "admin.password_reset.delivery",
		EventPrefix:           "password_reset",
		ConsumerPurpose:       "admin.password-reset.v1-consumer",
		RetryPublisherPurpose: "admin.password-reset.v1-retry-publisher",
		MaxBytes:              4_096,
		Secret:                SecretCode,
		Template:              AdminPasswordResetTemplate,
	}
}
