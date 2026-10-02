package unittest

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/eventa/discovery-service/internal/behaviour"
)

const (
	behaviourMessageID   = "9f1a6b2c-4d3e-4a5b-8c7d-1e2f3a4b5c6d"
	behaviourAttendeeID  = "2f3e4a5b-6c7d-4e8f-9a0b-1c2d3e4f5a6b"
	behaviourEventID     = "7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f"
	behaviourOrderID     = "3e4f5a6b-7c8d-4f9a-8b0c-1d2e3f4a5b6c"
	behaviourTicketID    = "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d"
	behaviourPaidAt      = "2026-09-29T10:15:00Z"
	behaviourCheckedInAt = "2026-09-30T19:40:00Z"
)

func orderPaidFact() map[string]any {
	return map[string]any{
		"type":         behaviour.OrderPaidType,
		"messageId":    behaviourMessageID,
		"orderId":      behaviourOrderID,
		"attendeeId":   behaviourAttendeeID,
		"eventId":      behaviourEventID,
		"ticketTypeId": "6b7c8d9e-0f1a-4b2c-8d3e-4f5a6b7c8d9e",
		"quantity":     2,
		"currency":     "NGN",
		"totalMinor":   100000,
		"paidAt":       behaviourPaidAt,
	}
}

func checkedInFact() map[string]any {
	return map[string]any{
		"type":        behaviour.CheckedInType,
		"messageId":   behaviourMessageID,
		"eventId":     behaviourEventID,
		"ticketId":    behaviourTicketID,
		"attendeeId":  behaviourAttendeeID,
		"checkedInAt": behaviourCheckedInAt,
	}
}

func marshalBehaviourFact(t *testing.T, fact map[string]any) []byte {
	t.Helper()
	body, err := json.Marshal(fact)
	if err != nil {
		t.Fatalf("marshal fact: %v", err)
	}
	return body
}

func TestOrderPaidFactIsAcceptedAsPurchasedEvidence(t *testing.T) {
	kind, fact, foreign := behaviour.ParseFact(marshalBehaviourFact(t, orderPaidFact()))

	if kind != behaviour.ParseOrderPaid {
		t.Fatalf("kind = %v, want ParseOrderPaid", kind)
	}
	if foreign != "" {
		t.Errorf("foreign type = %q, want empty", foreign)
	}
	if fact.Type != behaviour.OrderPaidType {
		t.Errorf("Type = %s, want %s", fact.Type, behaviour.OrderPaidType)
	}
	if fact.Kind != behaviour.KindPurchased {
		t.Errorf("Kind = %s, want %s", fact.Kind, behaviour.KindPurchased)
	}
	if fact.MessageID != behaviourMessageID || fact.AttendeeID != behaviourAttendeeID || fact.EventID != behaviourEventID {
		t.Errorf("identities = %+v, want the verbatim fact ids", fact)
	}
	if got, want := fact.OccurredAt.UTC().Format("2006-01-02T15:04:05Z07:00"), behaviourPaidAt; got != want {
		t.Errorf("OccurredAt = %s, want %s", got, want)
	}
}

func TestCheckedInFactIsAcceptedAsAttendedEvidence(t *testing.T) {
	kind, fact, _ := behaviour.ParseFact(marshalBehaviourFact(t, checkedInFact()))

	if kind != behaviour.ParseCheckedIn {
		t.Fatalf("kind = %v, want ParseCheckedIn", kind)
	}
	if fact.Type != behaviour.CheckedInType {
		t.Errorf("Type = %s, want %s", fact.Type, behaviour.CheckedInType)
	}
	if fact.Kind != behaviour.KindAttended {
		t.Errorf("Kind = %s, want %s", fact.Kind, behaviour.KindAttended)
	}
	if got, want := fact.OccurredAt.UTC().Format("2006-01-02T15:04:05Z07:00"), behaviourCheckedInAt; got != want {
		t.Errorf("OccurredAt = %s, want %s", got, want)
	}
}

// The order topic carries refunds and the check-in topic may carry other
// ticket facts later. Neither is behaviour, so both must be skipped rather
// than stall a shared topic Discovery does not exclusively own.
func TestFactsDiscoveryDoesNotActOnAreForeign(t *testing.T) {
	for _, factType := range []string{
		"commerce.order-refunded.v1",
		"ticket.revoked.v1",
		"event.published.v1",
	} {
		fact := orderPaidFact()
		fact["type"] = factType

		kind, _, foreignType := behaviour.ParseFact(marshalBehaviourFact(t, fact))
		if kind != behaviour.ParseForeign {
			t.Errorf("type %s classified as %v, want ParseForeign", factType, kind)
		}
		if foreignType != factType {
			t.Errorf("foreign type = %q, want %q", foreignType, factType)
		}
	}
}

func TestBehaviourFactWithoutATypeIsRejected(t *testing.T) {
	fact := orderPaidFact()
	delete(fact, "type")

	if kind, _, _ := behaviour.ParseFact(marshalBehaviourFact(t, fact)); kind != behaviour.ParseRejected {
		t.Fatalf("kind = %v, want ParseRejected", kind)
	}
}

// Every identity Discovery persists is a uuid column, so a fact that cannot
// be stored must fail before any database work.
func TestFactWithANonUuidIdentityIsRejected(t *testing.T) {
	for field, build := range map[string]func() map[string]any{
		"messageId":  orderPaidFact,
		"attendeeId": orderPaidFact,
		"eventId":    orderPaidFact,
	} {
		for name, candidate := range map[string]func() map[string]any{
			"paid":      build,
			"checkedIn": checkedInFact,
		} {
			fact := candidate()
			fact[field] = "not-a-uuid"
			if kind, _, _ := behaviour.ParseFact(marshalBehaviourFact(t, fact)); kind != behaviour.ParseRejected {
				t.Errorf("%s fact accepted with a non-uuid %s", name, field)
			}
		}
	}
}

func TestBehaviourFactWithANonRfc3339TimestampIsRejected(t *testing.T) {
	for field, build := range map[string]func() map[string]any{
		"paidAt":      orderPaidFact,
		"checkedInAt": checkedInFact,
	} {
		fact := build()
		fact[field] = "2026-09-29 10:15:00"
		if kind, _, _ := behaviour.ParseFact(marshalBehaviourFact(t, fact)); kind != behaviour.ParseRejected {
			t.Errorf("%s accepted a non-RFC3339 value", field)
		}
	}
}

// Each fact carries its own occurrence instant; the other type's field is not
// a substitute, so a swapped or renamed field is a contract violation.
func TestFactWithoutItsOwnOccurrenceFieldIsRejected(t *testing.T) {
	paid := orderPaidFact()
	delete(paid, "paidAt")
	if kind, _, _ := behaviour.ParseFact(marshalBehaviourFact(t, paid)); kind != behaviour.ParseRejected {
		t.Error("paid fact accepted without paidAt")
	}

	checked := checkedInFact()
	checked["paidAt"] = behaviourPaidAt
	delete(checked, "checkedInAt")
	if kind, _, _ := behaviour.ParseFact(marshalBehaviourFact(t, checked)); kind != behaviour.ParseRejected {
		t.Error("checked-in fact accepted without checkedInAt")
	}
}

func TestUnparseableBehaviourRecordsAreRejected(t *testing.T) {
	for name, value := range map[string][]byte{
		"not json": []byte("not json"),
		"null":     []byte("null"),
		"array":    []byte(`[{"type":"commerce.order-paid.v1"}]`),
		"nil":      nil,
	} {
		if kind, _, _ := behaviour.ParseFact(value); kind != behaviour.ParseRejected {
			t.Errorf("%s classified as %v, want ParseRejected", name, kind)
		}
	}
}

// A contract violation must fail before any database work, because the
// consumer deliberately leaves its offset uncommitted: a corrected producer
// redelivers the record. The nil pool proves no transaction was opened.
func TestBehaviourContractViolationFailsWithoutTouchingTheDatabase(t *testing.T) {
	ingest := behaviour.NewIngest(nil)

	_, err := ingest.Ingest(t.Context(), []byte(`{"type":"commerce.order-paid.v1"}`))
	if !errors.Is(err, behaviour.ErrFactRejected) {
		t.Fatalf("err = %v, want ErrFactRejected", err)
	}
}
