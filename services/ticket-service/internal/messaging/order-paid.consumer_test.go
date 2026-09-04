package messaging

import (
	"errors"
	"testing"
)

func TestDecodePaidOrderRejectsWrongEventType(t *testing.T) {
	_, err := decodePaidOrder([]byte(`{"type":"commerce.order-refunded.v1"}`))
	if !errors.Is(err, errPermanentMessage) {
		t.Fatalf("expected permanent failure, got %v", err)
	}
}

func TestDecodePaidOrderAcceptsCompleteEvent(t *testing.T) {
	event, err := decodePaidOrder([]byte(`{"messageId":"e55b806d-7547-43ca-89c5-2d7866551877","orderId":"1cb6670e-8c7b-447b-a779-fe638f21aef7","attendeeId":"3689eae7-77d2-4d3d-b1f8-d2923d56d35f","eventId":"dc49a834-4fd2-440e-bc5a-af68a0288d67","ticketTypeId":"3ef86cac-b938-4dc3-a9e7-88898e796209","quantity":2,"type":"commerce.order-paid.v1"}`))
	if err != nil {
		t.Fatal(err)
	}
	if event.Quantity != 2 {
		t.Fatalf("expected quantity 2, got %d", event.Quantity)
	}
}
