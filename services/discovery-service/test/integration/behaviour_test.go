package integration

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/eventa/discovery-service/internal/behaviour"
)

const (
	behaviourAttendeeA = "2f3e4a5b-6c7d-4e8f-9a0b-1c2d3e4f5a6b"
	behaviourAttendeeB = "4a5b6c7d-8e9f-4a0b-8c1d-2e3f4a5b6c7d"
	boughtEventID      = "7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f"
	secondBoughtID     = "6b7c8d9e-0f1a-4b3c-8d4e-5f6a7b8c9d0e"
	attendedEventID    = "8d9e0f1a-2b3c-4d4e-8f5a-6b7c8d9e0f1a"
	contentlessEventID = "9e0f1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b"

	paidMessageID     = "1a2b3c4d-5e6f-4a7b-8c8d-9e0f1a2b3c4d"
	secondPaidMsgID   = "2b3c4d5e-6f7a-4b8c-8d9e-0f1a2b3c4d5e"
	secondBoughtMsgID = "3d4e5f6a-7b8c-4d9e-8f0a-1b2c3d4e5f6a"
	attendedMessageID = "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f"

	firstPaidAt  = "2026-09-20T10:00:00Z"
	laterPaidAt  = "2026-09-28T15:30:00Z"
	checkedInDay = "2026-09-30T19:40:00Z"
)

func resetBehaviour(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	const tables = "TRUNCATE discovery_attendee_behaviour, discovery_behaviour_inbox"
	if _, err := pool.Exec(context.Background(), tables); err != nil {
		t.Fatalf("truncate behaviour tables: %v", err)
	}
}

func paidRecord(t *testing.T, messageID, attendeeID, eventID, paidAt string) []byte {
	t.Helper()
	body, err := json.Marshal(map[string]any{
		"type":       behaviour.OrderPaidType,
		"messageId":  messageID,
		"orderId":    uuid.New().String(),
		"attendeeId": attendeeID,
		"eventId":    eventID,
		"quantity":   1,
		"paidAt":     paidAt,
	})
	if err != nil {
		t.Fatalf("marshal paid fact: %v", err)
	}
	return body
}

func checkedInRecord(t *testing.T, messageID, attendeeID, eventID string) []byte {
	t.Helper()
	body, err := json.Marshal(map[string]any{
		"type":        behaviour.CheckedInType,
		"messageId":   messageID,
		"eventId":     eventID,
		"ticketId":    uuid.New().String(),
		"attendeeId":  attendeeID,
		"checkedInAt": checkedInDay,
	})
	if err != nil {
		t.Fatalf("marshal checked-in fact: %v", err)
	}
	return body
}

func behaviourInboxCount(t *testing.T, pool *pgxpool.Pool, factType, messageID string) int {
	t.Helper()
	var count int
	if err := pool.QueryRow(context.Background(), `
		SELECT count(*) FROM discovery_behaviour_inbox
		 WHERE event_type = $1 AND message_id = $2
	`, factType, messageID).Scan(&count); err != nil {
		t.Fatalf("read behaviour inbox: %v", err)
	}
	return count
}

// readBehaviour returns how many evidence rows exist for one attendee, event,
// and kind, and the occurrence time of the row when there is one.
func readBehaviour(t *testing.T, pool *pgxpool.Pool, attendeeID, eventID, kind string) (int, time.Time) {
	t.Helper()
	var (
		count      int
		occurredAt sql.NullTime
	)
	err := pool.QueryRow(context.Background(), `
		SELECT count(*), max(occurred_at)
		  FROM discovery_attendee_behaviour
		 WHERE attendee_id = $1 AND event_id = $2 AND kind = $3
	`, attendeeID, eventID, kind).Scan(&count, &occurredAt)
	if err != nil {
		t.Fatalf("read behaviour row: %v", err)
	}
	return count, occurredAt.Time
}

// seedProjection inserts the projection row the evidence read joins against.
// An empty title stores a contentless row, the shape a tombstone or a
// publication Event Service no longer serves has.
func seedProjection(t *testing.T, pool *pgxpool.Pool, eventID, title, city string) {
	t.Helper()
	_, err := pool.Exec(context.Background(), `
		INSERT INTO discovery_event_index (
			event_id, status, version, published_at, title, categories, venue_city)
		VALUES ($1, 'published', 1, now(), NULLIF($2, ''), '{music}', NULLIF($3, ''))
	`, eventID, title, city)
	if err != nil {
		t.Fatalf("seed projection row: %v", err)
	}
}

// The claim and the evidence land together: one delivered paid-order fact
// gives the attendee durable purchased evidence for that event.
func TestPaidFactRecordsPurchasedEvidenceWithItsClaim(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetBehaviour(t, pool)

	outcome, err := behaviour.NewIngest(pool).Ingest(context.Background(),
		paidRecord(t, paidMessageID, behaviourAttendeeA, boughtEventID, firstPaidAt))
	if err != nil {
		t.Fatalf("Ingest error = %v", err)
	}
	if outcome != behaviour.OutcomeProcessed {
		t.Fatalf("outcome = %s, want %s", outcome, behaviour.OutcomeProcessed)
	}

	if count := behaviourInboxCount(t, pool, behaviour.OrderPaidType, paidMessageID); count != 1 {
		t.Errorf("inbox rows = %d, want 1", count)
	}
	count, occurredAt := readBehaviour(t, pool, behaviourAttendeeA, boughtEventID, "purchased")
	if count != 1 {
		t.Fatalf("behaviour rows = %d, want 1", count)
	}
	if want := mustParseTime(t, firstPaidAt); !occurredAt.Equal(want) {
		t.Errorf("occurred_at = %s, want %s", occurredAt, want)
	}
}

func TestCheckedInFactRecordsAttendedEvidenceWithItsClaim(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetBehaviour(t, pool)

	outcome, err := behaviour.NewIngest(pool).Ingest(context.Background(),
		checkedInRecord(t, attendedMessageID, behaviourAttendeeA, attendedEventID))
	if err != nil {
		t.Fatalf("Ingest error = %v", err)
	}
	if outcome != behaviour.OutcomeProcessed {
		t.Fatalf("outcome = %s, want %s", outcome, behaviour.OutcomeProcessed)
	}

	if count := behaviourInboxCount(t, pool, behaviour.CheckedInType, attendedMessageID); count != 1 {
		t.Errorf("inbox rows = %d, want 1", count)
	}
	count, _ := readBehaviour(t, pool, behaviourAttendeeA, attendedEventID, "attended")
	if count != 1 {
		t.Errorf("behaviour rows = %d, want 1", count)
	}
}

// Attending and purchasing the same event are different evidence kinds and
// must not collapse into one row: the rendering weights them differently.
func TestPurchasedAndAttendedAreSeparateEvidenceKinds(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetBehaviour(t, pool)
	ingest := behaviour.NewIngest(pool)

	if _, err := ingest.Ingest(context.Background(),
		paidRecord(t, paidMessageID, behaviourAttendeeA, boughtEventID, firstPaidAt)); err != nil {
		t.Fatalf("paid Ingest error = %v", err)
	}
	if _, err := ingest.Ingest(context.Background(),
		checkedInRecord(t, attendedMessageID, behaviourAttendeeA, boughtEventID)); err != nil {
		t.Fatalf("checked-in Ingest error = %v", err)
	}

	if count, _ := readBehaviour(t, pool, behaviourAttendeeA, boughtEventID, "purchased"); count != 1 {
		t.Errorf("purchased rows = %d, want 1", count)
	}
	if count, _ := readBehaviour(t, pool, behaviourAttendeeA, boughtEventID, "attended"); count != 1 {
		t.Errorf("attended rows = %d, want 1", count)
	}
}

// A replayed fact is already-known knowledge: it must not create a second
// claim or a second evidence row, which is what makes a broker redelivery or
// a consumer restart harmless.
func TestReplayedBehaviourFactIsADuplicateAndStoresOneRow(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetBehaviour(t, pool)
	ingest := behaviour.NewIngest(pool)

	if _, err := ingest.Ingest(context.Background(),
		paidRecord(t, paidMessageID, behaviourAttendeeA, boughtEventID, firstPaidAt)); err != nil {
		t.Fatalf("first Ingest error = %v", err)
	}

	outcome, err := ingest.Ingest(context.Background(),
		paidRecord(t, paidMessageID, behaviourAttendeeA, boughtEventID, firstPaidAt))
	if err != nil {
		t.Fatalf("replay Ingest error = %v", err)
	}
	if outcome != behaviour.OutcomeDuplicate {
		t.Fatalf("outcome = %s, want %s", outcome, behaviour.OutcomeDuplicate)
	}

	if count := behaviourInboxCount(t, pool, behaviour.OrderPaidType, paidMessageID); count != 1 {
		t.Errorf("inbox rows = %d, want 1", count)
	}
	if count, _ := readBehaviour(t, pool, behaviourAttendeeA, boughtEventID, "purchased"); count != 1 {
		t.Errorf("behaviour rows = %d, want 1", count)
	}
}

// Two distinct purchases of one event stay one evidence row — the weight is
// the kind, not the count — and the stored occurrence is the newest one even
// when an older fact arrives afterwards.
func TestRepeatEvidenceKeepsOneRowWithTheNewestOccurrence(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetBehaviour(t, pool)
	ingest := behaviour.NewIngest(pool)

	if _, err := ingest.Ingest(context.Background(),
		paidRecord(t, paidMessageID, behaviourAttendeeA, boughtEventID, laterPaidAt)); err != nil {
		t.Fatalf("first Ingest error = %v", err)
	}
	if _, err := ingest.Ingest(context.Background(),
		paidRecord(t, secondPaidMsgID, behaviourAttendeeA, boughtEventID, firstPaidAt)); err != nil {
		t.Fatalf("second Ingest error = %v", err)
	}

	count, occurredAt := readBehaviour(t, pool, behaviourAttendeeA, boughtEventID, "purchased")
	if count != 1 {
		t.Fatalf("behaviour rows = %d, want 1", count)
	}
	if want := mustParseTime(t, laterPaidAt); !occurredAt.Equal(want) {
		t.Errorf("occurred_at = %s, want the newest %s", occurredAt, want)
	}
	if count := behaviourInboxCount(t, pool, behaviour.OrderPaidType, secondPaidMsgID); count != 1 {
		t.Errorf("second fact inbox rows = %d, want 1", count)
	}
}

// A fact about one attendee must never become evidence for another: the
// attendee id inside the fact is the only identity persisted.
func TestEvidenceIsScopedToTheAttendeeInTheFact(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetBehaviour(t, pool)
	ingest := behaviour.NewIngest(pool)

	if _, err := ingest.Ingest(context.Background(),
		paidRecord(t, paidMessageID, behaviourAttendeeA, boughtEventID, firstPaidAt)); err != nil {
		t.Fatalf("Ingest error = %v", err)
	}

	if count, _ := readBehaviour(t, pool, behaviourAttendeeB, boughtEventID, "purchased"); count != 0 {
		t.Errorf("other attendee rows = %d, want 0", count)
	}
}

func TestAForeignFactIsIgnoredWithoutWritingAnything(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetBehaviour(t, pool)

	foreign, err := json.Marshal(map[string]any{
		"type":       "commerce.order-refunded.v1",
		"messageId":  paidMessageID,
		"attendeeId": behaviourAttendeeA,
		"eventId":    boughtEventID,
		"refundedAt": firstPaidAt,
	})
	if err != nil {
		t.Fatalf("marshal foreign fact: %v", err)
	}

	outcome, err := behaviour.NewIngest(pool).Ingest(context.Background(), foreign)
	if err != nil {
		t.Fatalf("Ingest error = %v", err)
	}
	if outcome != behaviour.OutcomeIgnored {
		t.Fatalf("outcome = %s, want %s", outcome, behaviour.OutcomeIgnored)
	}
	if count := behaviourInboxCount(t, pool, "commerce.order-refunded.v1", paidMessageID); count != 0 {
		t.Errorf("inbox rows = %d, want 0", count)
	}
	if count, _ := readBehaviour(t, pool, behaviourAttendeeA, boughtEventID, "purchased"); count != 0 {
		t.Errorf("behaviour rows = %d, want 0", count)
	}
}

// A record that breaks the fact contract is never claimed: the error is what
// leaves the offset uncommitted, so no partial write survives to make a later
// corrected redelivery look like a duplicate.
func TestAMalformedBehaviourFactIsRejectedWithoutWritingAnything(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetBehaviour(t, pool)

	malformed, err := json.Marshal(map[string]any{
		"type":       behaviour.OrderPaidType,
		"messageId":  paidMessageID,
		"attendeeId": "not-a-uuid",
		"eventId":    boughtEventID,
		"paidAt":     firstPaidAt,
	})
	if err != nil {
		t.Fatalf("marshal malformed fact: %v", err)
	}

	_, err = behaviour.NewIngest(pool).Ingest(context.Background(), malformed)
	if !errors.Is(err, behaviour.ErrFactRejected) {
		t.Fatalf("err = %v, want ErrFactRejected", err)
	}
	if count := behaviourInboxCount(t, pool, behaviour.OrderPaidType, paidMessageID); count != 0 {
		t.Errorf("inbox rows = %d, want 0", count)
	}
	if count, _ := readBehaviour(t, pool, behaviourAttendeeA, boughtEventID, "purchased"); count != 0 {
		t.Errorf("behaviour rows = %d, want 0", count)
	}
}

// The renderer reads through this: most recent evidence first, bounded by the
// caller, and only events Discovery actually holds content for — evidence for
// a contentless event stays stored but never reaches the preference text.
func TestEvidenceReadReturnsContentRowsNewestFirstAndBounded(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetIndex(t, pool)
	resetBehaviour(t, pool)

	seedProjection(t, pool, boughtEventID, "Harbour Lights Festival", "Bristol")
	seedProjection(t, pool, secondBoughtID, "River Jazz Cruise", "Accra")
	seedProjection(t, pool, attendedEventID, "Jazz Night", "Lagos")
	seedProjection(t, pool, contentlessEventID, "", "")

	ingest := behaviour.NewIngest(pool)
	if _, err := ingest.Ingest(context.Background(),
		paidRecord(t, paidMessageID, behaviourAttendeeA, boughtEventID, firstPaidAt)); err != nil {
		t.Fatalf("paid Ingest error = %v", err)
	}
	if _, err := ingest.Ingest(context.Background(),
		paidRecord(t, secondBoughtMsgID, behaviourAttendeeA, secondBoughtID, laterPaidAt)); err != nil {
		t.Fatalf("second paid Ingest error = %v", err)
	}
	if _, err := ingest.Ingest(context.Background(),
		checkedInRecord(t, attendedMessageID, behaviourAttendeeA, attendedEventID)); err != nil {
		t.Fatalf("checked-in Ingest error = %v", err)
	}
	if _, err := ingest.Ingest(context.Background(),
		paidRecord(t, secondPaidMsgID, behaviourAttendeeA, contentlessEventID, laterPaidAt)); err != nil {
		t.Fatalf("contentless Ingest error = %v", err)
	}

	repository := behaviour.NewRepository(pool)
	attendeeID := uuid.MustParse(behaviourAttendeeA)

	attended, err := repository.Evidence(context.Background(), attendeeID, behaviour.KindAttended, 10)
	if err != nil {
		t.Fatalf("attended evidence: %v", err)
	}
	if len(attended) != 1 || attended[0].EventID != attendedEventID || attended[0].Title != "Jazz Night" {
		t.Fatalf("attended evidence = %+v, want the one content row", attended)
	}

	purchased, err := repository.Evidence(context.Background(), attendeeID, behaviour.KindPurchased, 10)
	if err != nil {
		t.Fatalf("purchased evidence: %v", err)
	}
	if len(purchased) != 2 {
		t.Fatalf("purchased evidence rows = %d, want 2 (the contentless event is not renderable)", len(purchased))
	}
	if purchased[0].EventID != secondBoughtID || purchased[0].Title != "River Jazz Cruise" {
		t.Errorf("first purchased evidence = %+v, want the newest buy", purchased[0])
	}
	if purchased[1].EventID != boughtEventID || purchased[1].Title != "Harbour Lights Festival" {
		t.Errorf("second purchased evidence = %+v, want the older buy", purchased[1])
	}
	if purchased[1].VenueCity == nil || *purchased[1].VenueCity != "Bristol" {
		t.Errorf("venue city = %v, want Bristol", purchased[1].VenueCity)
	}

	bounded, err := repository.Evidence(context.Background(), attendeeID, behaviour.KindPurchased, 1)
	if err != nil {
		t.Fatalf("bounded evidence: %v", err)
	}
	if len(bounded) != 1 || bounded[0].EventID != secondBoughtID {
		t.Errorf("bounded evidence = %+v, want only the newest row", bounded)
	}
}

func mustParseTime(t *testing.T, raw string) time.Time {
	t.Helper()
	parsed, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		t.Fatalf("parse %q: %v", raw, err)
	}
	return parsed
}
