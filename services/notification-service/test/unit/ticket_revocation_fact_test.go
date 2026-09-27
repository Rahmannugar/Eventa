package unittest

import (
	"encoding/json"
	"testing"

	"github.com/eventa/notification-service/internal/cancellation"
)

const (
	revokedMessageID = "1f0a5e7b-3c44-4a3f-9c2d-0b9a6e2f2b1e"
	revokedTicketID  = "2b1e4a3f-9c2d-1f0a-8e7b-3c440b9a6e2f"
	revokedEventID   = "3c2d1f0a-5e7b-4344-8a3f-9c2d1f0a5e7b"
	revokedAttendee  = "4d3e2f1b-6a8c-4d5e-9f0a-1b2c3d4e5f60"
	revokedAt        = "2026-09-27T10:15:00.000Z"
)

func revocationFact() map[string]string {
	return map[string]string{
		"attendeeId": revokedAttendee,
		"eventId":    revokedEventID,
		"messageId":  revokedMessageID,
		"revokedAt":  revokedAt,
		"ticketId":   revokedTicketID,
		"type":       "ticket.revoked.v1",
	}
}

func marshalFact(t *testing.T, fact map[string]string) []byte {
	t.Helper()
	body, err := json.Marshal(fact)
	if err != nil {
		t.Fatalf("marshal fact: %v", err)
	}
	return body
}

func TestTicketRevokedFactIsAcceptedVerbatim(t *testing.T) {
	kind, fact, _ := cancellation.ParseFact(marshalFact(t, revocationFact()))

	if kind != cancellation.ParseAccepted {
		t.Fatalf("kind = %v, want ParseAccepted", kind)
	}
	if fact.MessageID != revokedMessageID {
		t.Errorf("MessageID = %s, want %s", fact.MessageID, revokedMessageID)
	}
	if fact.TicketID != revokedTicketID {
		t.Errorf("TicketID = %s, want %s", fact.TicketID, revokedTicketID)
	}
	if fact.EventID != revokedEventID {
		t.Errorf("EventID = %s, want %s", fact.EventID, revokedEventID)
	}
	if fact.AttendeeID != revokedAttendee {
		t.Errorf("AttendeeID = %s, want %s", fact.AttendeeID, revokedAttendee)
	}
	if fact.RevokedAt != revokedAt {
		t.Errorf("RevokedAt = %s, want %s", fact.RevokedAt, revokedAt)
	}
	if fact.Type != "ticket.revoked.v1" {
		t.Errorf("Type = %s, want ticket.revoked.v1", fact.Type)
	}
}

func TestFactOfAnotherTypeIsIgnored(t *testing.T) {
	fact := revocationFact()
	fact["type"] = "ticket.checked-in.v1"

	kind, _, eventType := cancellation.ParseFact(marshalFact(t, fact))
	if kind != cancellation.ParseForeign {
		t.Fatalf("kind = %v, want ParseForeign", kind)
	}
	if eventType != "ticket.checked-in.v1" {
		t.Errorf("event type = %s, want ticket.checked-in.v1", eventType)
	}
}

func TestFactWithoutATypeIsRejected(t *testing.T) {
	fact := revocationFact()
	delete(fact, "type")

	kind, _, _ := cancellation.ParseFact(marshalFact(t, fact))
	if kind != cancellation.ParseRejected {
		t.Fatalf("kind = %v, want ParseRejected", kind)
	}
}

func TestFactWithANonUuidIdentityIsRejected(t *testing.T) {
	for _, field := range []string{"attendeeId", "eventId", "messageId", "ticketId"} {
		fact := revocationFact()
		fact[field] = "not-a-uuid"

		kind, _, _ := cancellation.ParseFact(marshalFact(t, fact))
		if kind != cancellation.ParseRejected {
			t.Errorf("%s rejected = false, want ParseRejected", field)
		}
	}
}

func TestFactWithoutARevokedAtIsRejected(t *testing.T) {
	fact := revocationFact()
	fact["revokedAt"] = ""

	kind, _, _ := cancellation.ParseFact(marshalFact(t, fact))
	if kind != cancellation.ParseRejected {
		t.Fatalf("kind = %v, want ParseRejected", kind)
	}
}

func TestUnparseableFactIsRejected(t *testing.T) {
	kind, _, _ := cancellation.ParseFact([]byte("not json"))
	if kind != cancellation.ParseRejected {
		t.Fatalf("kind = %v, want ParseRejected", kind)
	}
}

func TestNullFactIsRejected(t *testing.T) {
	kind, _, _ := cancellation.ParseFact([]byte("null"))
	if kind != cancellation.ParseRejected {
		t.Fatalf("kind = %v, want ParseRejected", kind)
	}
}
