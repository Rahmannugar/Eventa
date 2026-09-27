package auth

import (
	"bytes"
	"encoding/json"
	"io"
	"regexp"
	"sort"
	"time"

	"github.com/eventa/notification-service/internal/email/validate"
)

var (
	uuidV4    = regexp.MustCompile(`(?i)^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$`)
	sixDigits = regexp.MustCompile(`^\d{6}$`)
)

// Invalid is a job the consumer must acknowledge without delivering. JobID is
// present only when the broker's message ID was itself a UUID v4, which is the
// only identity the service can trust for a payload it refused to read.
type Invalid struct {
	FailureCode string
	JobID       *string
}

// Validate applies the thirteen checks the TypeScript validators applied, in
// the same order, so the reported failure code identifies the same broken field.
func Validate(definition Definition, contentType, propertyType, messageID string, body []byte) (Job, *Invalid) {
	var propertyJobID *string
	if uuidV4.MatchString(messageID) {
		propertyJobID = &messageID
	}

	invalid := func(failureCode string, jobID *string) (Job, *Invalid) {
		return Job{}, &Invalid{FailureCode: failureCode, JobID: jobID}
	}

	if len(body) > definition.MaxBytes {
		return invalid("JOB_PAYLOAD_TOO_LARGE", propertyJobID)
	}
	if contentType != "application/json" {
		return invalid("JOB_CONTENT_TYPE_INVALID", propertyJobID)
	}
	if propertyType != definition.JobType {
		return invalid("JOB_PROPERTY_TYPE_INVALID", propertyJobID)
	}

	payload, ok := decodeObject(body)
	if !ok {
		return invalid("JOB_JSON_INVALID", propertyJobID)
	}

	keys := make([]string, 0, len(payload))
	for key := range payload {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	expected := []string{"expiresAt", "jobId", definition.SecretKey(), "recipientEmail", "type"}
	sort.Strings(expected)
	if !equalStrings(keys, expected) {
		return invalid("JOB_FIELDS_INVALID", propertyJobID)
	}

	jobID := rawString(payload["jobId"])
	if jobID == nil || !uuidV4.MatchString(*jobID) {
		return invalid("JOB_ID_INVALID", propertyJobID)
	}
	if propertyJobID == nil || *propertyJobID != *jobID {
		return invalid("JOB_ID_MISMATCH", propertyJobID)
	}
	if rawString(payload["type"]) == nil || *rawString(payload["type"]) != definition.JobType {
		return invalid("JOB_TYPE_INVALID", jobID)
	}

	recipient := rawString(payload["recipientEmail"])
	if recipient == nil || len(*recipient) > 320 || !validate.IsEmail(*recipient) {
		return invalid("JOB_RECIPIENT_INVALID", jobID)
	}

	secret := rawString(payload[definition.SecretKey()])
	if secret == nil || !sixDigits.MatchString(*secret) {
		return invalid(definition.SecretFailureCode(), jobID)
	}

	expiresAt := rawString(payload["expiresAt"])
	if expiresAt == nil || !isCanonicalTimestamp(*expiresAt) {
		return invalid("JOB_EXPIRY_INVALID", jobID)
	}

	return Job{
		JobID:          *jobID,
		Type:           definition.JobType,
		RecipientEmail: *recipient,
		ExpiresAt:      *expiresAt,
		Secret:         *secret,
	}, nil
}

func decodeObject(body []byte) (map[string]any, bool) {
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.UseNumber()

	var payload any
	if err := decoder.Decode(&payload); err != nil {
		return nil, false
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return nil, false
	}
	fields, ok := payload.(map[string]any)
	return fields, ok
}

func rawString(value any) *string {
	text, ok := value.(string)
	if !ok {
		return nil
	}
	return &text
}

func equalStrings(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}

// isCanonicalTimestamp mirrors `new Date(value).toISOString() === value`, so a
// timestamp survives only when the service produced it in canonical UTC form.
func isCanonicalTimestamp(value string) bool {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return false
	}
	return parsed.UTC().Format("2006-01-02T15:04:05.000Z") == value
}
