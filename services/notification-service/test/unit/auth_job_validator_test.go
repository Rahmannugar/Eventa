package unittest

import (
	"strings"
	"testing"

	"github.com/eventa/notification-service/internal/auth"
)

const (
	jobID   = "0b9a6e2f-2b1e-4a3f-9c2d-1f0a5e7b3c44"
	otherID = "6c1f9d5a-77c4-4a61-8b3e-9d2f4a8e5b70"
	expiry  = "2026-07-23T12:30:00.000Z"
)

func definitionFor(t *testing.T, jobType string) auth.Definition {
	t.Helper()
	for _, definition := range auth.Definitions() {
		if definition.JobType == jobType {
			return definition
		}
	}
	t.Fatalf("no definition registered for %s", jobType)
	return auth.Definition{}
}

type message struct {
	contentType string
	jobType     string
	messageID   string
	body        string
	// propertyType is the AMQP `type` header when it differs from the payload
	// type the definition expects.
	propertyType string
}

func validVerificationMessage() message {
	return message{
		contentType: "application/json",
		jobType:     "attendee.email-verification.v1",
		messageID:   jobID,
		body: `{"expiresAt":"` + expiry + `","jobId":"` + jobID + `",` +
			`"otp":"123456","recipientEmail":"attendee@example.com",` +
			`"type":"attendee.email-verification.v1"}`,
	}
}

func (m message) validate(t *testing.T) (auth.Job, *auth.Invalid) {
	t.Helper()
	definition := definitionFor(t, m.jobType)
	propertyType := m.propertyType
	if propertyType == "" {
		propertyType = m.jobType
	}
	return auth.Validate(definition, m.contentType, propertyType, m.messageID, []byte(m.body))
}

func requireValid(t *testing.T, m message) auth.Job {
	t.Helper()
	job, invalid := m.validate(t)
	if invalid != nil {
		t.Fatalf("invalid = %+v, want a valid job", *invalid)
	}
	return job
}

func requireInvalid(t *testing.T, m message, failureCode string) *auth.Invalid {
	t.Helper()
	_, invalid := m.validate(t)
	if invalid == nil {
		t.Fatalf("invalid = nil, want failure code %s", failureCode)
	}
	if invalid.FailureCode != failureCode {
		t.Fatalf("failure code = %s, want %s", invalid.FailureCode, failureCode)
	}
	return invalid
}

func TestValidVerificationJobParsesEveryField(t *testing.T) {
	job := requireValid(t, validVerificationMessage())

	if job.JobID != jobID {
		t.Errorf("JobID = %s, want %s", job.JobID, jobID)
	}
	if job.Type != "attendee.email-verification.v1" {
		t.Errorf("Type = %s, want attendee.email-verification.v1", job.Type)
	}
	if job.RecipientEmail != "attendee@example.com" {
		t.Errorf("RecipientEmail = %s, want attendee@example.com", job.RecipientEmail)
	}
	if job.ExpiresAt != expiry {
		t.Errorf("ExpiresAt = %s, want %s", job.ExpiresAt, expiry)
	}
	if job.Secret != "123456" {
		t.Errorf("Secret = %s, want 123456", job.Secret)
	}
}

func TestExtraPayloadFieldIsRejected(t *testing.T) {
	m := validVerificationMessage()
	m.body = `{"expiresAt":"` + expiry + `","extra":true,"jobId":"` + jobID + `",` +
		`"otp":"123456","recipientEmail":"attendee@example.com",` +
		`"type":"attendee.email-verification.v1"}`

	requireInvalid(t, m, "JOB_FIELDS_INVALID")
}

func TestFiveDigitCodeIsRejected(t *testing.T) {
	m := validVerificationMessage()
	m.body = `{"expiresAt":"` + expiry + `","jobId":"` + jobID + `",` +
		`"otp":"12345","recipientEmail":"attendee@example.com",` +
		`"type":"attendee.email-verification.v1"}`

	requireInvalid(t, m, "JOB_OTP_INVALID")
}

func TestNonCanonicalExpiryIsRejected(t *testing.T) {
	m := validVerificationMessage()
	m.body = `{"expiresAt":"2026-07-23T12:15:00Z","jobId":"` + jobID + `",` +
		`"otp":"123456","recipientEmail":"attendee@example.com",` +
		`"type":"attendee.email-verification.v1"}`

	requireInvalid(t, m, "JOB_EXPIRY_INVALID")
}

func TestPayloadJobTypeAheadOfThisVersionIsRejected(t *testing.T) {
	m := validVerificationMessage()
	m.body = `{"expiresAt":"` + expiry + `","jobId":"` + jobID + `",` +
		`"otp":"123456","recipientEmail":"attendee@example.com",` +
		`"type":"attendee.email-verification.v2"}`

	requireInvalid(t, m, "JOB_TYPE_INVALID")
}

func TestBrokerMessageTypeAheadOfThisVersionIsRejected(t *testing.T) {
	m := validVerificationMessage()
	m.propertyType = "attendee.email-verification.v2"

	requireInvalid(t, m, "JOB_PROPERTY_TYPE_INVALID")
}

func TestMessageIdDifferentFromPayloadJobIdCarriesTheBrokerId(t *testing.T) {
	m := validVerificationMessage()
	m.messageID = otherID

	invalid := requireInvalid(t, m, "JOB_ID_MISMATCH")
	if invalid.JobID == nil {
		t.Fatal("JobID = nil, want the broker message id")
	}
	if *invalid.JobID != otherID {
		t.Errorf("JobID = %s, want %s", *invalid.JobID, otherID)
	}
}

func TestOversizedPayloadIsRejectedBeforeAnythingElse(t *testing.T) {
	m := validVerificationMessage()
	padded := strings.Repeat("a", 3000)
	m.body = `{"expiresAt":"` + expiry + `","jobId":"` + jobID + `",` +
		`"otp":"123456","recipientEmail":"` + padded + `@example.com",` +
		`"type":"attendee.email-verification.v1"}`

	// The content type and broker type are also wrong, so only the size check
	// can be the reason this is refused.
	m.contentType = ""
	requireInvalid(t, m, "JOB_PAYLOAD_TOO_LARGE")
}

func TestPasswordResetCodeIsValidWhereOtpWouldNotBe(t *testing.T) {
	definition := definitionFor(t, "attendee.password-reset.v1")
	body := `{"code":"654321","expiresAt":"` + expiry + `","jobId":"` + jobID + `",` +
		`"recipientEmail":"attendee@example.com","type":"attendee.password-reset.v1"}`

	job, invalid := auth.Validate(definition, "application/json", definition.JobType, jobID, []byte(body))
	if invalid != nil {
		t.Fatalf("invalid = %+v, want a valid job", *invalid)
	}
	if job.Secret != "654321" {
		t.Errorf("Secret = %s, want 654321", job.Secret)
	}
}

func TestPasswordResetWithOtpInsteadOfCodeIsRejected(t *testing.T) {
	definition := definitionFor(t, "admin.password-reset.v1")
	body := `{"expiresAt":"` + expiry + `","jobId":"` + jobID + `",` +
		`"otp":"654321","recipientEmail":"admin@example.com","type":"admin.password-reset.v1"}`

	_, invalid := auth.Validate(definition, "application/json", definition.JobType, jobID, []byte(body))
	if invalid == nil {
		t.Fatal("invalid = nil, want JOB_FIELDS_INVALID")
	}
	if invalid.FailureCode != "JOB_FIELDS_INVALID" {
		t.Errorf("failure code = %s, want JOB_FIELDS_INVALID", invalid.FailureCode)
	}
}

func TestAdminActivationAcceptsItsOwnJobType(t *testing.T) {
	requireValid(t, message{
		contentType: "application/json",
		jobType:     "admin.activation.v1",
		messageID:   jobID,
		body: `{"expiresAt":"` + expiry + `","jobId":"` + jobID + `",` +
			`"otp":"123456","recipientEmail":"admin@example.com",` +
			`"type":"admin.activation.v1"}`,
	})
}

func TestRejectWithoutABrokerMessageIdCarriesNoJobId(t *testing.T) {
	invalid := requireInvalid(t, message{
		contentType: "application/json",
		jobType:     "attendee.email-verification.v1",
		messageID:   "",
		body:        "not json",
	}, "JOB_JSON_INVALID")

	if invalid.JobID != nil {
		t.Errorf("JobID = %s, want no job id when the broker message id is not a uuid", *invalid.JobID)
	}
}

func TestRecipientLongerThanThreeHundredTwentyCharactersIsRejected(t *testing.T) {
	m := validVerificationMessage()
	long := make([]byte, 321)
	for i := range long {
		long[i] = 'a'
	}
	m.body = `{"expiresAt":"` + expiry + `","jobId":"` + jobID + `",` +
		`"otp":"123456","recipientEmail":"` + string(long) + `@example.com",` +
		`"type":"attendee.email-verification.v1"}`

	requireInvalid(t, m, "JOB_RECIPIENT_INVALID")
}
