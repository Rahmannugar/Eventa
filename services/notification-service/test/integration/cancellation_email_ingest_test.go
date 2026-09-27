package integration

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/eventa/notification-service/internal/cancellation"
)

func newRevocationFact(attendeeID string) cancellation.Fact {
	return cancellation.Fact{
		MessageID:  uuid.NewString(),
		EventID:    uuid.NewString(),
		TicketID:   uuid.NewString(),
		AttendeeID: attendeeID,
		RevokedAt:  "2026-09-27T10:15:00.000Z",
		Type:       cancellation.FactType,
	}
}

func countRows(t *testing.T, pool *pgxpool.Pool, table string) int {
	t.Helper()
	var count int
	if err := pool.QueryRow(context.Background(),
		"SELECT count(*) FROM "+table).Scan(&count); err != nil {
		t.Fatalf("count %s: %v", table, err)
	}
	return count
}

func TestFirstRevocationWritesOneDeliveryOneInboxAndOneOutbox(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetCancellation(t, pool)
	repository := cancellation.NewRepository(pool)
	fact := newRevocationFact(uuid.NewString())

	record, err := repository.RecordRevocation(context.Background(), fact)
	if err != nil {
		t.Fatalf("RecordRevocation error = %v", err)
	}
	if record.Kind != cancellation.RevocationCreated {
		t.Fatalf("kind = %s, want created", record.Kind)
	}

	if got := countRows(t, pool, "cancellation_email_deliveries"); got != 1 {
		t.Errorf("deliveries = %d, want 1", got)
	}
	if got := countRows(t, pool, "ticket_revocation_inbox"); got != 1 {
		t.Errorf("inbox = %d, want 1", got)
	}
	if got := countRows(t, pool, "notification_job_outbox"); got != 1 {
		t.Errorf("outbox = %d, want 1", got)
	}

	var aggregateType, routingKey, eventType string
	var payloadDeliveryID, payloadType string
	if err := pool.QueryRow(context.Background(), `
		SELECT aggregate_type, routing_key, event_type,
		       payload->>'deliveryId', payload->>'type'
		FROM notification_job_outbox
	`).Scan(&aggregateType, &routingKey, &eventType, &payloadDeliveryID, &payloadType); err != nil {
		t.Fatalf("read outbox row: %v", err)
	}
	if aggregateType != "eventa.notification.jobs" {
		t.Errorf("aggregate_type = %s, want the notification jobs exchange", aggregateType)
	}
	if routingKey != "eventa.notification.event-cancellation-email.v1" {
		t.Errorf("routing_key = %s, want the cancellation queue", routingKey)
	}
	if eventType != "notification.event-cancellation-email.v1" {
		t.Errorf("event_type = %s, want the cancellation job type", eventType)
	}
	if payloadDeliveryID != record.DeliveryID {
		t.Errorf("payload deliveryId = %s, want %s", payloadDeliveryID, record.DeliveryID)
	}
	if payloadType != "notification.event-cancellation-email.v1" {
		t.Errorf("payload type = %s, want the cancellation job type", payloadType)
	}
}

func TestSecondRevocationForTheSameAttendeeIsGrouped(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetCancellation(t, pool)
	repository := cancellation.NewRepository(pool)
	attendee := uuid.NewString()

	first := newRevocationFact(attendee)
	second := newRevocationFact(attendee)
	second.EventID = first.EventID

	if _, err := repository.RecordRevocation(context.Background(), first); err != nil {
		t.Fatalf("first RecordRevocation error = %v", err)
	}
	record, err := repository.RecordRevocation(context.Background(), second)
	if err != nil {
		t.Fatalf("second RecordRevocation error = %v", err)
	}
	if record.Kind != cancellation.RevocationGrouped {
		t.Fatalf("kind = %s, want grouped", record.Kind)
	}

	if got := countRows(t, pool, "cancellation_email_deliveries"); got != 1 {
		t.Errorf("deliveries = %d, want 1", got)
	}
	if got := countRows(t, pool, "ticket_revocation_inbox"); got != 2 {
		t.Errorf("inbox = %d, want 2", got)
	}
	if got := countRows(t, pool, "notification_job_outbox"); got != 1 {
		t.Errorf("outbox = %d, want 1", got)
	}
}

func TestReplayedMessageIdIsADuplicate(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetCancellation(t, pool)
	repository := cancellation.NewRepository(pool)
	fact := newRevocationFact(uuid.NewString())

	if _, err := repository.RecordRevocation(context.Background(), fact); err != nil {
		t.Fatalf("first RecordRevocation error = %v", err)
	}
	record, err := repository.RecordRevocation(context.Background(), fact)
	if err != nil {
		t.Fatalf("replay RecordRevocation error = %v", err)
	}
	if record.Kind != cancellation.RevocationDuplicate {
		t.Fatalf("kind = %s, want duplicate", record.Kind)
	}

	if got := countRows(t, pool, "cancellation_email_deliveries"); got != 1 {
		t.Errorf("deliveries = %d, want 1", got)
	}
	if got := countRows(t, pool, "ticket_revocation_inbox"); got != 1 {
		t.Errorf("inbox = %d, want 1", got)
	}
	if got := countRows(t, pool, "notification_job_outbox"); got != 1 {
		t.Errorf("outbox = %d, want 1", got)
	}
}

func TestSecondAttendeeOnTheSameEventGetsItsOwnDelivery(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetCancellation(t, pool)
	repository := cancellation.NewRepository(pool)

	first := newRevocationFact(uuid.NewString())
	second := newRevocationFact(uuid.NewString())
	second.EventID = first.EventID

	if _, err := repository.RecordRevocation(context.Background(), first); err != nil {
		t.Fatalf("first RecordRevocation error = %v", err)
	}
	record, err := repository.RecordRevocation(context.Background(), second)
	if err != nil {
		t.Fatalf("second RecordRevocation error = %v", err)
	}
	if record.Kind != cancellation.RevocationCreated {
		t.Fatalf("kind = %s, want created", record.Kind)
	}

	if got := countRows(t, pool, "cancellation_email_deliveries"); got != 2 {
		t.Errorf("deliveries = %d, want 2", got)
	}
	if got := countRows(t, pool, "notification_job_outbox"); got != 2 {
		t.Errorf("outbox = %d, want 2", got)
	}
}

func TestInvalidAttendeeRollsTheWholeRevocationBack(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetCancellation(t, pool)
	repository := cancellation.NewRepository(pool)
	fact := newRevocationFact("not-a-uuid")

	if _, err := repository.RecordRevocation(context.Background(), fact); err == nil {
		t.Fatal("RecordRevocation error = nil, want the invalid uuid to fail the transaction")
	}

	if got := countRows(t, pool, "cancellation_email_deliveries"); got != 0 {
		t.Errorf("deliveries = %d, want 0", got)
	}
	if got := countRows(t, pool, "ticket_revocation_inbox"); got != 0 {
		t.Errorf("inbox = %d, want 0", got)
	}
	if got := countRows(t, pool, "notification_job_outbox"); got != 0 {
		t.Errorf("outbox = %d, want 0", got)
	}
}
