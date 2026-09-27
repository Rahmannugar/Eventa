package unittest

import (
	"strings"
	"testing"

	"github.com/eventa/notification-service/internal/cancellation"
)

const cancelDeliveryID = "0b9a6e2f-2b1e-4a3f-9c2d-1f0a5e7b3c44"

// validCancellationBody is the exact payload the outbox row hands to the
// Debezium relay. The relayed message carries no AMQP properties at all, so the
// payload alone has to be the whole contract.
func validCancellationBody() string {
	return `{"deliveryId":"` + cancelDeliveryID + `","type":"notification.event-cancellation-email.v1"}`
}

func requireValidCancellation(t *testing.T, body string) cancellation.Job {
	t.Helper()
	job, invalid := cancellation.Validate([]byte(body))
	if invalid != nil {
		t.Fatalf("invalid = %+v, want a valid job", *invalid)
	}
	return job
}

func requireInvalidCancellation(t *testing.T, body, failureCode string) *cancellation.Invalid {
	t.Helper()
	_, invalid := cancellation.Validate([]byte(body))
	if invalid == nil {
		t.Fatalf("invalid = nil, want failure code %s", failureCode)
	}
	if invalid.FailureCode != failureCode {
		t.Fatalf("failure code = %s, want %s", invalid.FailureCode, failureCode)
	}
	return invalid
}

func TestRelayedCancellationJobWithoutBrokerPropertiesIsValid(t *testing.T) {
	job := requireValidCancellation(t, validCancellationBody())

	if job.DeliveryID != cancelDeliveryID {
		t.Errorf("DeliveryID = %s, want %s", job.DeliveryID, cancelDeliveryID)
	}
	if job.Type != "notification.event-cancellation-email.v1" {
		t.Errorf("Type = %s, want notification.event-cancellation-email.v1", job.Type)
	}
}

func TestCancellationJobWithAnUnexpectedFieldIsRejected(t *testing.T) {
	body := `{"deliveryId":"` + cancelDeliveryID + `","type":"notification.event-cancellation-email.v1","pad":true}`

	invalid := requireInvalidCancellation(t, body, "JOB_FIELDS_INVALID")
	if invalid.DeliveryID != cancelDeliveryID {
		t.Errorf("DeliveryID = %s, want %s", invalid.DeliveryID, cancelDeliveryID)
	}
}

func TestCancellationJobMissingItsDeliveryIdKeyIsRejected(t *testing.T) {
	invalid := requireInvalidCancellation(t,
		`{"type":"notification.event-cancellation-email.v1"}`, "JOB_FIELDS_INVALID")

	if invalid.DeliveryID != "" {
		t.Errorf("DeliveryID = %q, want no delivery id when the payload has no readable one", invalid.DeliveryID)
	}
}

func TestCancellationJobWithANonUuidDeliveryIdCarriesNoDeliveryId(t *testing.T) {
	invalid := requireInvalidCancellation(t,
		`{"deliveryId":"not-a-uuid","type":"notification.event-cancellation-email.v1"}`, "JOB_ID_INVALID")

	if invalid.DeliveryID != "" {
		t.Errorf("DeliveryID = %q, want no delivery id when the payload id is not a uuid", invalid.DeliveryID)
	}
}

func TestCancellationJobFromAnotherVersionIsRejected(t *testing.T) {
	body := `{"deliveryId":"` + cancelDeliveryID + `","type":"notification.event-cancellation-email.v2"}`

	invalid := requireInvalidCancellation(t, body, "JOB_TYPE_INVALID")
	if invalid.DeliveryID != cancelDeliveryID {
		t.Errorf("DeliveryID = %s, want %s", invalid.DeliveryID, cancelDeliveryID)
	}
}

func TestNonObjectCancellationPayloadIsRejected(t *testing.T) {
	requireInvalidCancellation(t, `["`+cancelDeliveryID+`"]`, "JOB_PAYLOAD_INVALID")
	requireInvalidCancellation(t, `"notification.event-cancellation-email.v1"`, "JOB_PAYLOAD_INVALID")
	requireInvalidCancellation(t, `null`, "JOB_PAYLOAD_INVALID")
}

func TestUnparseableCancellationPayloadIsRejected(t *testing.T) {
	invalid := requireInvalidCancellation(t, "not json", "JOB_JSON_INVALID")
	if invalid.DeliveryID != "" {
		t.Errorf("DeliveryID = %q, want no delivery id when nothing could be read", invalid.DeliveryID)
	}
}

func TestCancellationJobLargerThanThePayloadLimitIsRejected(t *testing.T) {
	padded := strings.Repeat("a", 3000)
	body := `{"deliveryId":"` + cancelDeliveryID + `","type":"notification.event-cancellation-email.v1","pad":"` + padded + `"}`

	invalid := requireInvalidCancellation(t, body, "JOB_PAYLOAD_TOO_LARGE")
	if invalid.DeliveryID != cancelDeliveryID {
		t.Errorf("DeliveryID = %s, want %s", invalid.DeliveryID, cancelDeliveryID)
	}
}
