package cancellation

import (
	"encoding/json"
	"regexp"
	"sort"
)

// Invalid is a job the consumer must acknowledge without delivering. DeliveryID
// is present only when the payload itself carried a readable delivery id, which
// is the only identity that can be trusted for a payload the service refused.
type Invalid struct {
	FailureCode string
	DeliveryID  string
}

// Job is a validated cancellation job.
type Job struct {
	DeliveryID string
	Type       string
}

// uuidAllPattern is validator.js's `all` UUID test: versions 1 to 8 with the
// RFC 4122 variant, plus the nil and max UUIDs.
var uuidAllPattern = regexp.MustCompile(`(?i)^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$`)

// Validate reads a cancellation job payload. The relayed message carries no
// AMQP properties at all, so the payload is the entire contract: content type,
// message id and type properties are deliberately not inspected.
func Validate(body []byte) (Job, *Invalid) {
	invalid := func(failureCode, deliveryID string) (Job, *Invalid) {
		return Job{}, &Invalid{FailureCode: failureCode, DeliveryID: deliveryID}
	}

	var payload any
	if err := json.Unmarshal(body, &payload); err != nil {
		return invalid("JOB_JSON_INVALID", "")
	}
	record, ok := payload.(map[string]any)
	if !ok || record == nil {
		return invalid("JOB_PAYLOAD_INVALID", "")
	}

	deliveryID := knownDeliveryID(record["deliveryId"])

	if len(body) > JobMaxBytes {
		return invalid("JOB_PAYLOAD_TOO_LARGE", deliveryID)
	}

	keys := make([]string, 0, len(record))
	for key := range record {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	if len(keys) != 2 || keys[0] != "deliveryId" || keys[1] != "type" {
		return invalid("JOB_FIELDS_INVALID", deliveryID)
	}

	if deliveryID == "" {
		return invalid("JOB_ID_INVALID", "")
	}

	if kind, _ := record["type"].(string); kind != JobType {
		return invalid("JOB_TYPE_INVALID", deliveryID)
	}

	return Job{DeliveryID: deliveryID, Type: JobType}, nil
}

func knownDeliveryID(value any) string {
	raw, ok := value.(string)
	if !ok || !uuidAllPattern.MatchString(raw) {
		return ""
	}
	return raw
}
