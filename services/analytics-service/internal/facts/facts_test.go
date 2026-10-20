package facts

import (
	"strings"
	"testing"
	"time"
)

const (
	testEventID     = "11111111-1111-4111-8111-111111111111"
	testMessageID   = "22222222-2222-4222-8222-222222222222"
	testOrderID     = "33333333-3333-4333-8333-333333333333"
	testTicketID    = "44444444-4444-4444-8444-444444444444"
	testTypeID      = "55555555-5555-4555-8555-555555555555"
	testAttendeeID  = "66666666-6666-4666-8666-666666666666"
	testPaidAt      = "2026-10-20T10:00:00Z"
	testCheckedInAt = "2026-10-20T11:00:00Z"
	testRevokedAt   = "2026-10-20T12:00:00Z"
	testPublishedAt = "2026-10-01T09:00:00Z"
	testCancelledAt = "2026-10-19T18:00:00Z"
)

func orderPayload(eventType string, timestampKey string, timestamp string) []byte {
	return []byte(`{
		"type": "` + eventType + `",
		"messageId": "` + testMessageID + `",
		"orderId": "` + testOrderID + `",
		"attendeeId": "` + testAttendeeID + `",
		"eventId": "` + testEventID + `",
		"ticketTypeId": "` + testTypeID + `",
		"quantity": 3,
		"currency": "USD",
		"totalMinor": 15000,
		"` + timestampKey + `": "` + timestamp + `"
	}`)
}

func TestParseClassifiesEveryOwnedFactType(t *testing.T) {
	cases := []struct {
		name      string
		value     []byte
		wantKind  Kind
		wantEvent string
	}{
		{
			name:      "order paid",
			value:     orderPayload(OrderPaidType, "paidAt", testPaidAt),
			wantKind:  KindOrderPaid,
			wantEvent: testEventID,
		},
		{
			name:      "order refunded",
			value:     orderPayload(OrderRefundedType, "refundedAt", testPaidAt),
			wantKind:  KindOrderRefunded,
			wantEvent: testEventID,
		},
		{
			name: "checked in",
			value: []byte(`{
				"type": "` + CheckedInType + `",
				"messageId": "` + testMessageID + `",
				"eventId": "` + testEventID + `",
				"ticketId": "` + testTicketID + `",
				"attendeeId": "` + testAttendeeID + `",
				"checkedInAt": "` + testCheckedInAt + `"
			}`),
			wantKind:  KindCheckedIn,
			wantEvent: testEventID,
		},
		{
			name: "revoked",
			value: []byte(`{
				"type": "` + RevokedType + `",
				"messageId": "` + testMessageID + `",
				"eventId": "` + testEventID + `",
				"ticketId": "` + testTicketID + `",
				"attendeeId": "` + testAttendeeID + `",
				"revokedAt": "` + testRevokedAt + `"
			}`),
			wantKind:  KindRevoked,
			wantEvent: testEventID,
		},
		{
			name: "published",
			value: []byte(`{
				"type": "` + PublishedType + `",
				"eventId": "` + testEventID + `",
				"publishedAt": "` + testPublishedAt + `",
				"version": 1
			}`),
			wantKind:  KindPublished,
			wantEvent: testEventID,
		},
		{
			name: "cancelled",
			value: []byte(`{
				"type": "` + CancelledType + `",
				"messageId": "` + testMessageID + `",
				"eventId": "` + testEventID + `",
				"cancelledAt": "` + testCancelledAt + `"
			}`),
			wantKind:  KindCancelled,
			wantEvent: testEventID,
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			kind, fact, foreign := Parse(testCase.value)
			if kind != testCase.wantKind {
				t.Fatalf("kind = %d, want %d", kind, testCase.wantKind)
			}
			if foreign != "" {
				t.Errorf("foreign = %q, want empty", foreign)
			}
			if fact.EventID != testCase.wantEvent {
				t.Errorf("event id = %q, want %q", fact.EventID, testCase.wantEvent)
			}
		})
	}
}

func TestParseExtractsOrderAmountAndIdentity(t *testing.T) {
	kind, fact, _ := Parse(orderPayload(OrderPaidType, "paidAt", testPaidAt))
	if kind != KindOrderPaid {
		t.Fatalf("kind = %d, want KindOrderPaid", kind)
	}
	if fact.Quantity != 3 || fact.TotalMinor != 15000 || fact.Currency != "USD" {
		t.Errorf("quantity/total/currency = %d/%d/%q", fact.Quantity, fact.TotalMinor, fact.Currency)
	}
	if fact.OrderID != testOrderID || fact.TicketTypeID != testTypeID || fact.AttendeeID != testAttendeeID {
		t.Errorf("identity fields = %q/%q/%q", fact.OrderID, fact.TicketTypeID, fact.AttendeeID)
	}
	want := time.Date(2026, 10, 20, 10, 0, 0, 0, time.UTC)
	if !fact.OccurredAt.Equal(want) {
		t.Errorf("occurred at = %v, want %v", fact.OccurredAt, want)
	}
}

func TestParseAcknowledgesForeignFactsWithoutValidation(t *testing.T) {
	kind, _, foreign := Parse([]byte(`{"type":"email.sent.v1"}`))
	if kind != KindForeign || foreign != "email.sent.v1" {
		t.Fatalf("kind/foreign = %d/%q", kind, foreign)
	}
}

func TestParseRejectsBrokenContracts(t *testing.T) {
	cases := []struct {
		name  string
		value []byte
	}{
		{"nil", nil},
		{"not json", []byte(`{`)},
		{"no type", []byte(`{"eventId":"` + testEventID + `"}`)},
		{
			"bad event uuid",
			[]byte(`{"type":"` + PublishedType + `","eventId":"nope","publishedAt":"` + testPublishedAt + `","version":1}`),
		},
		{
			"missing published timestamp",
			[]byte(`{"type":"` + PublishedType + `","eventId":"` + testEventID + `","version":1}`),
		},
		{
			"negative version",
			[]byte(`{"type":"` + PublishedType + `","eventId":"` + testEventID + `","publishedAt":"` + testPublishedAt + `","version":-1}`),
		},
		{
			"bad currency",
			[]byte(strings.Replace(string(orderPayload(OrderPaidType, "paidAt", testPaidAt)), `"USD"`, `"dollars"`, 1)),
		},
		{
			"zero quantity",
			[]byte(strings.Replace(string(orderPayload(OrderPaidType, "paidAt", testPaidAt)), `"quantity": 3`, `"quantity": 0`, 1)),
		},
		{
			"fractional quantity",
			[]byte(strings.Replace(string(orderPayload(OrderPaidType, "paidAt", testPaidAt)), `"quantity": 3`, `"quantity": 1.5`, 1)),
		},
		{
			"checked in without ticket id",
			[]byte(`{"type":"` + CheckedInType + `","messageId":"` + testMessageID + `","eventId":"` + testEventID + `","checkedInAt":"` + testCheckedInAt + `"}`),
		},
		{
			"cancelled without message id",
			[]byte(`{"type":"` + CancelledType + `","eventId":"` + testEventID + `","cancelledAt":"` + testCancelledAt + `"}`),
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if kind, _, _ := Parse(testCase.value); kind != KindRejected {
				t.Fatalf("kind = %d, want KindRejected", kind)
			}
		})
	}
}

func TestPublishedFactDedupeKeyIsTheEventID(t *testing.T) {
	_, fact, _ := Parse([]byte(`{"type":"` + PublishedType + `","eventId":"` + testEventID + `","publishedAt":"` + testPublishedAt + `","version":1}`))
	if fact.DedupeKey() != testEventID {
		t.Errorf("dedupe key = %q, want event id", fact.DedupeKey())
	}
}

func TestOrderedFactDedupeKeyIsTheMessageID(t *testing.T) {
	_, fact, _ := Parse(orderPayload(OrderPaidType, "paidAt", testPaidAt))
	if fact.DedupeKey() != testMessageID {
		t.Errorf("dedupe key = %q, want message id", fact.DedupeKey())
	}
}
