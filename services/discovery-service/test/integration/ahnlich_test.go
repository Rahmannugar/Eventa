package integration

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/eventa/discovery-service/internal/semantic"
	"github.com/eventa/discovery-service/internal/semantic/ahnlich"
)

// testStore is the semantic store these cases write to. It is only ever reached
// through the real Ahnlich AI proxy named by TEST_AHNLICH_AI_URL.
const testStore = "eventa_events_test"

const testModel = "all-minilm-l6-v2"

// realStore opens the adapter against the running Ahnlich AI proxy. The suite
// is skipped without TEST_AHNLICH_AI_URL, so a machine without the proxy still
// runs the rest of the integration tests.
func realStore(t *testing.T) *ahnlich.Client {
	t.Helper()

	address := os.Getenv("TEST_AHNLICH_AI_URL")
	if address == "" {
		t.Skip("TEST_AHNLICH_AI_URL is not set")
	}

	// The first embed loads the model into the proxy, which can take far
	// longer than a steady-state call.
	client, err := ahnlich.Dial(address, testStore, testModel, 60000)
	if err != nil {
		t.Fatalf("dial ahnlich ai: %v", err)
	}
	t.Cleanup(func() { _ = client.Close() })

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	if err := client.EnsureStore(ctx); err != nil {
		t.Fatalf("ensure store: %v", err)
	}
	return client
}

// uniqueEventID returns a random UUID, the type discovery_event_index stores.
func uniqueEventID(t *testing.T) string {
	t.Helper()
	buffer := make([]byte, 16)
	if _, err := rand.Read(buffer); err != nil {
		t.Fatalf("random event id: %v", err)
	}
	buffer[6] = (buffer[6] & 0x0f) | 0x40
	buffer[8] = (buffer[8] & 0x3f) | 0x80
	raw := hex.EncodeToString(buffer)
	return raw[:8] + "-" + raw[8:12] + "-" + raw[12:16] + "-" + raw[16:20] + "-" + raw[20:]
}

func TestRealStoreIndexesSearchesAndRemovesAnEvent(t *testing.T) {
	client := realStore(t)
	eventID := uniqueEventID(t)
	text := "Harbour Lights Festival\nLive music on the waterfront.\nCategories: music\nNorth Dock, Bristol"

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	if err := client.IndexEvent(ctx, eventID, text, semantic.Attribute{
		Key: semantic.EventAttributeKey, Value: eventID,
	}); err != nil {
		t.Fatalf("IndexEvent: %v", err)
	}

	present, err := client.Contains(ctx, eventID)
	if err != nil {
		t.Fatalf("Contains: %v", err)
	}
	if !present {
		t.Fatal("store does not hold the event it was just given")
	}

	candidates, err := client.Search(ctx, text, 5)
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	found := false
	for _, candidate := range candidates {
		if candidate.EventID == eventID {
			found = true
			if candidate.Similarity <= 0 {
				t.Errorf("similarity = %v, want a positive score", candidate.Similarity)
			}
		}
	}
	if !found {
		t.Errorf("Search returned %d candidates without the indexed event", len(candidates))
	}

	if err := client.RemoveEvent(ctx, eventID); err != nil {
		t.Fatalf("RemoveEvent: %v", err)
	}
	present, err = client.Contains(ctx, eventID)
	if err != nil {
		t.Fatalf("Contains: %v", err)
	}
	if present {
		t.Fatal("store still holds an event that was removed")
	}
}

func TestRealStoreCountsRemovingAnEventItNeverHeldAsSuccess(t *testing.T) {
	client := realStore(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := client.RemoveEvent(ctx, uniqueEventID(t)); err != nil {
		t.Fatalf("RemoveEvent: %v", err)
	}
}

func TestDialRejectsAnUnknownModel(t *testing.T) {
	if _, err := ahnlich.Dial("127.0.0.1:1370", testStore, "not-a-model", 1000); err == nil {
		t.Fatal("Dial = nil error, want an unknown model error")
	}
}

// Nothing listens on port 1, so this stays a real connection refusal even when
// the proxy itself is running locally.
func TestUnreachableProxyIsClassifiedAsUnavailable(t *testing.T) {
	client, err := ahnlich.Dial("127.0.0.1:1", testStore, testModel, 500)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer func() { _ = client.Close() }()

	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	err = client.Ping(ctx)
	if err == nil {
		t.Fatal("Ping = nil error, want an unreachable proxy error")
	}
	if class := semantic.ErrorClass(err); class != "unavailable" && class != "deadline_exceeded" {
		t.Errorf("error class = %q, want a transport class", class)
	}
	if strings.Contains(err.Error(), "query") {
		t.Error("error carries payload text")
	}
}
