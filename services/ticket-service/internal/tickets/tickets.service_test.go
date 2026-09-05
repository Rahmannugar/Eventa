package tickets

import (
	"errors"
	"testing"
	"time"
)

func TestCursorRoundTripPreservesTimestampAndTicketID(t *testing.T) {
	want := Cursor{IssuedAt: time.Date(2026, 9, 5, 12, 30, 0, 123000000, time.UTC), ID: ID("3689eae7-77d2-4d3d-b1f8-d2923d56d35f")}
	encoded, err := EncodeCursor(want)
	if err != nil {
		t.Fatal(err)
	}
	got, err := DecodeCursor(encoded)
	if err != nil {
		t.Fatal(err)
	}
	if !got.IssuedAt.Equal(want.IssuedAt) || got.ID != want.ID {
		t.Fatalf("cursor changed after round trip: got %#v want %#v", got, want)
	}
}

func TestDecodeCursorRejectsMalformedValue(t *testing.T) {
	_, err := DecodeCursor("not-a-cursor")
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected invalid input, got %v", err)
	}
}
