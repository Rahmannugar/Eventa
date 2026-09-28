package unittest

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/eventa/discovery-service/internal/index"
)

const (
	publishedEventID   = "3c2d1f0a-5e7b-4344-8a3f-9c2d1f0a5e7b"
	cancelledMessageID = "1f0a5e7b-3c44-4a3f-9c2d-0b9a6e2f2b1e"
	publishedAt        = "2026-09-27T19:17:45Z"
	cancelledAt        = "2026-09-28T08:03:12Z"
)

func publishedFact() map[string]any {
	return map[string]any{
		"type":        index.PublishedType,
		"eventId":     publishedEventID,
		"version":     4,
		"publishedAt": publishedAt,
	}
}

func cancelledFact() map[string]any {
	return map[string]any{
		"type":        index.CancelledType,
		"eventId":     publishedEventID,
		"messageId":   cancelledMessageID,
		"cancelledAt": cancelledAt,
	}
}

func marshalFact(t *testing.T, fact map[string]any) []byte {
	t.Helper()
	body, err := json.Marshal(fact)
	if err != nil {
		t.Fatalf("marshal fact: %v", err)
	}
	return body
}

func TestPublishedFactIsAcceptedVerbatim(t *testing.T) {
	kind, fact, foreign := index.ParseFact(marshalFact(t, publishedFact()))

	if kind != index.ParsePublished {
		t.Fatalf("kind = %v, want ParsePublished", kind)
	}
	if foreign != "" {
		t.Errorf("foreign type = %q, want empty", foreign)
	}
	if fact.Type != index.PublishedType {
		t.Errorf("Type = %s, want %s", fact.Type, index.PublishedType)
	}
	if fact.EventID != publishedEventID {
		t.Errorf("EventID = %s, want %s", fact.EventID, publishedEventID)
	}
	if fact.Version != 4 {
		t.Errorf("Version = %d, want 4", fact.Version)
	}
	if fact.PublishedAt.IsZero() {
		t.Error("PublishedAt is zero")
	}
	if got, want := fact.PublishedAt.UTC().Format("2006-01-02T15:04:05Z07:00"), publishedAt; got != want {
		t.Errorf("PublishedAt = %s, want %s", got, want)
	}
}

func TestCancelledFactIsAcceptedVerbatim(t *testing.T) {
	kind, fact, _ := index.ParseFact(marshalFact(t, cancelledFact()))

	if kind != index.ParseCancelled {
		t.Fatalf("kind = %v, want ParseCancelled", kind)
	}
	if fact.Type != index.CancelledType {
		t.Errorf("Type = %s, want %s", fact.Type, index.CancelledType)
	}
	if fact.MessageID != cancelledMessageID {
		t.Errorf("MessageID = %s, want %s", fact.MessageID, cancelledMessageID)
	}
	if got, want := fact.CancelledAt.UTC().Format("2006-01-02T15:04:05Z07:00"), cancelledAt; got != want {
		t.Errorf("CancelledAt = %s, want %s", got, want)
	}
}

// A published fact has no message id of its own, so a replayed publication is
// the same fact rather than a new one, while two cancellations of the same
// event stay distinct records. Without that split the inbox either drops a
// real second cancellation or re-applies the same publish.
func TestDedupeKeySplitsPublishIdentityFromCancellationIdentity(t *testing.T) {
	_, published, _ := index.ParseFact(marshalFact(t, publishedFact()))
	_, cancelled, _ := index.ParseFact(marshalFact(t, cancelledFact()))

	if published.DedupeKey() != publishedEventID {
		t.Errorf("published DedupeKey = %s, want %s", published.DedupeKey(), publishedEventID)
	}
	if cancelled.DedupeKey() != cancelledMessageID {
		t.Errorf("cancelled DedupeKey = %s, want %s", cancelled.DedupeKey(), cancelledMessageID)
	}
	if published.DedupeKey() == cancelled.DedupeKey() {
		t.Error("publish and cancellation of one event share a dedupe key")
	}
}

func TestFactOfAnotherTypeIsIgnored(t *testing.T) {
	fact := cancelledFact()
	fact["type"] = "event.updated.v1"

	kind, _, foreignType := index.ParseFact(marshalFact(t, fact))
	if kind != index.ParseForeign {
		t.Fatalf("kind = %v, want ParseForeign", kind)
	}
	if foreignType != "event.updated.v1" {
		t.Errorf("foreign type = %s, want event.updated.v1", foreignType)
	}
}

func TestFactWithoutATypeIsRejected(t *testing.T) {
	fact := cancelledFact()
	delete(fact, "type")

	if kind, _, _ := index.ParseFact(marshalFact(t, fact)); kind != index.ParseRejected {
		t.Fatalf("kind = %v, want ParseRejected", kind)
	}
}

func TestFactWithANonUuidEventIdIsRejected(t *testing.T) {
	for _, build := range []func() map[string]any{publishedFact, cancelledFact} {
		fact := build()
		fact["eventId"] = "not-a-uuid"
		if kind, _, _ := index.ParseFact(marshalFact(t, fact)); kind != index.ParseRejected {
			t.Errorf("type %s accepted with a non-uuid event id", fact["type"])
		}
	}
}

func TestPublishedFactWithAnInvalidVersionIsRejected(t *testing.T) {
	for name, version := range map[string]any{
		"absent":    nil,
		"fraction":  1.5,
		"negative":  -1,
		"nonnumber": "4",
	} {
		fact := publishedFact()
		if version == nil {
			delete(fact, "version")
		} else {
			fact["version"] = version
		}
		if kind, _, _ := index.ParseFact(marshalFact(t, fact)); kind != index.ParseRejected {
			t.Errorf("version %s accepted", name)
		}
	}
}

func TestFactWithANonRfc3339TimestampIsRejected(t *testing.T) {
	for field, build := range map[string]func() map[string]any{
		"publishedAt": publishedFact,
		"cancelledAt": cancelledFact,
	} {
		fact := build()
		fact[field] = "2026-09-27 19:17:45"
		if kind, _, _ := index.ParseFact(marshalFact(t, fact)); kind != index.ParseRejected {
			t.Errorf("%s accepted a non-RFC3339 value", field)
		}
	}
}

func TestCancelledFactWithoutAMessageIdIsRejected(t *testing.T) {
	fact := cancelledFact()
	delete(fact, "messageId")

	if kind, _, _ := index.ParseFact(marshalFact(t, fact)); kind != index.ParseRejected {
		t.Fatalf("kind = %v, want ParseRejected", kind)
	}
}

func TestUnparseableAndNullRecordsAreRejected(t *testing.T) {
	for name, value := range map[string][]byte{
		"not json": []byte("not json"),
		"null":     []byte("null"),
		"array":    []byte(`[{"type":"event.published.v1"}]`),
		"nil":      nil,
	} {
		if kind, _, _ := index.ParseFact(value); kind != index.ParseRejected {
			t.Errorf("%s classified as %v, want ParseRejected", name, kind)
		}
	}
}

// A contract violation must fail before any database work, because the
// consumer deliberately leaves its offset uncommitted: a corrected producer
// redelivers the record. The nil pool proves no transaction was opened.
func TestContractViolationFailsWithoutTouchingTheDatabase(t *testing.T) {
	ingest := index.NewIngest(nil, nil)

	_, err := ingest.Ingest(t.Context(), []byte(`{"type":"event.published.v1"}`))
	if !errors.Is(err, index.ErrFactRejected) {
		t.Fatalf("err = %v, want ErrFactRejected", err)
	}
}
