package checkin

import (
	"encoding/base64"
	"errors"
	"testing"

	"github.com/google/uuid"
)

func TestParseRequestRejectsMalformedQRCodeBeforePersistence(t *testing.T) {
	_, _, _, err := parseRequest(Request{QRToken: "!", EventID: uuid.NewString(), CheckedInBy: uuid.NewString()})
	if err == nil || !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected invalid input, got %v", err)
	}
}

func TestParseRequestHashesDecodedQRCode(t *testing.T) {
	raw := []byte("ticket-secret")
	hash, eventID, actor, err := parseRequest(Request{QRToken: base64.RawURLEncoding.EncodeToString(raw), EventID: uuid.NewString(), CheckedInBy: uuid.NewString()})
	if err != nil || hash == [32]byte{} || eventID == uuid.Nil || actor == uuid.Nil {
		t.Fatalf("expected parsed request, got hash=%x event=%s actor=%s err=%v", hash, eventID, actor, err)
	}
}
