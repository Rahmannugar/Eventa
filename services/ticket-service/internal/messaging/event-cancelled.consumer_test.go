package messaging

import (
	"errors"
	"testing"
)

func TestDecodeEventCancelledSkipsFactsTicketDoesNotOwn(t *testing.T) {
	event, skip, err := decodeEventCancelled([]byte(`{"type":"event.published.v1","eventId":"dc49a834-4fd2-440e-bc5a-af68a0288d67"}`))
	if err != nil {
		t.Fatal(err)
	}
	if !skip || event.Type != "" {
		t.Fatalf("expected skip without event, got skip=%v event=%+v", skip, event)
	}
}

func TestDecodeEventCancelledRejectsIncompleteCancellation(t *testing.T) {
	_, skip, err := decodeEventCancelled([]byte(`{"type":"event.cancelled.v1","messageId":"","eventId":""}`))
	if !errors.Is(err, errPermanentCancellation) || skip {
		t.Fatalf("expected permanent failure, got skip=%v err=%v", skip, err)
	}
}

func TestDecodeEventCancelledRejectsNonUUIDIdentifiers(t *testing.T) {
	_, skip, err := decodeEventCancelled([]byte(`{"type":"event.cancelled.v1","messageId":"a","eventId":"b"}`))
	if !errors.Is(err, errPermanentCancellation) || skip {
		t.Fatalf("expected permanent failure, got skip=%v err=%v", skip, err)
	}
}

func TestDecodeEventCancelledAcceptsCompleteFact(t *testing.T) {
	event, skip, err := decodeEventCancelled([]byte(`{"type":"event.cancelled.v1","messageId":"e55b806d-7547-43ca-89c5-2d7866551877","eventId":"dc49a834-4fd2-440e-bc5a-af68a0288d67"}`))
	if err != nil || skip {
		t.Fatalf("expected owned fact, got skip=%v err=%v", skip, err)
	}
	if event.EventID == "" || event.MessageID == "" {
		t.Fatal("expected identifiers")
	}
}
