package integration

import (
	"context"
	"sort"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/eventa/tools/seeder/internal/attendeeseed"
)

// Ranges live inside the generator's name space and stay disjoint, exactly as
// the CLI requires of a real run.
const (
	attendeeSeed           = int64(606060)
	attendeePassword       = "EventaDev!2026"
	attendeeOffsetContract = 0
	attendeeOffsetRollback = 400
	attendeeOffsetRepair   = 800
)

// TestSeededAttendeesAreVerifiedAndKeepTheirInterests is the slice's contract:
// an account Identity accepts for login, an interest row that Discovery owns
// beside it, and a rerun that changes nothing.
func TestSeededAttendeesAreVerifiedAndKeepTheirInterests(t *testing.T) {
	identity := startIdentityDatabase(t)
	discovery := startDiscoveryDatabase(t)
	ctx := context.Background()

	now := time.Now().UTC()
	batch := generateAttendees(attendeeSeed, attendeeOffsetContract, 12, now, attendeePassword)
	ids := attendeeIDs(batch)
	cleanupAttendees(t, identity, discovery, ids)

	if written := insertAccounts(t, identity, batch); written != int64(len(batch)) {
		t.Fatalf("first run inserted %d accounts, want %d", written, len(batch))
	}
	if changed := upsertInterests(t, discovery, batch); changed != int64(len(batch)) {
		t.Fatalf("first run wrote %d interest rows, want %d", changed, len(batch))
	}

	var ready int
	if err := identity.QueryRow(ctx, `
		SELECT count(*) FROM attendee_accounts
		WHERE id = ANY($1) AND status = 'active' AND deleted_at IS NULL
		  AND email_verified_at IS NOT NULL AND email = lower(email)
		  AND email LIKE '%@eventa.com'`, ids).Scan(&ready); err != nil {
		t.Fatalf("check login-ready accounts: %v", err)
	}
	if ready != len(batch) {
		t.Fatalf("%d of %d accounts are active, verified, and canonical", ready, len(batch))
	}

	// The stored credential must be the one Identity's argon2 verifier accepts,
	// so read the hashes back out of the database rather than trusting memory.
	rows, err := identity.Query(ctx, `SELECT password_hash FROM attendee_accounts WHERE id = ANY($1)`, ids)
	if err != nil {
		t.Fatalf("read credentials: %v", err)
	}
	checked := 0
	for rows.Next() {
		var hash string
		if err := rows.Scan(&hash); err != nil {
			t.Fatalf("scan credential: %v", err)
		}
		if !attendeeseed.VerifyPassword(hash, attendeePassword) {
			t.Fatal("a stored credential rejects the shared password")
		}
		checked++
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate credentials: %v", err)
	}
	rows.Close()
	if checked != len(batch) {
		t.Fatalf("checked %d credentials, want %d", checked, len(batch))
	}

	stored := storedInterests(t, discovery, ids)
	if len(stored) != len(batch) {
		t.Fatalf("stored %d interest rows, want %d", len(stored), len(batch))
	}
	for _, attendee := range batch {
		got, exists := stored[attendee.ID]
		if !exists {
			t.Fatalf("attendee %s has no interests", attendee.Email)
		}
		if stringsOf(got) != stringsOf(attendee.Interests) {
			t.Fatalf("attendee %s interests = %v, want %v", attendee.Email, got, attendee.Interests)
		}
	}

	// A rerun of the same range must add no account and change no interest.
	if written := insertAccounts(t, identity, batch); written != 0 {
		t.Fatalf("rerun inserted %d accounts, want 0", written)
	}
	if changed := upsertInterests(t, discovery, batch); changed != 0 {
		t.Fatalf("rerun changed %d interest rows, want 0", changed)
	}
}

// TestAFailedAccountBatchLeavesNothingBehind proves the transactional claim:
// a batch that trips an Identity constraint commits no accounts, so a failed
// seed never leaves half a range behind.
func TestAFailedAccountBatchLeavesNothingBehind(t *testing.T) {
	identity := startIdentityDatabase(t)
	discovery := startDiscoveryDatabase(t)
	ctx := context.Background()

	now := time.Now().UTC()
	batch := generateAttendees(attendeeSeed, attendeeOffsetRollback, 6, now, attendeePassword)
	batch[2].Username = "Not A Username" // breaks the canonical username rule
	ids := attendeeIDs(batch)
	cleanupAttendees(t, identity, discovery, ids)

	tx, err := identity.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	if _, err := attendeeseed.InsertAccounts(ctx, tx, batch); err == nil {
		t.Fatal("a non-canonical username must be rejected by the schema")
	} else if err := tx.Rollback(ctx); err != nil {
		t.Fatalf("rollback: %v", err)
	}

	var stored int
	if err := identity.QueryRow(ctx, `SELECT count(*) FROM attendee_accounts WHERE id = ANY($1)`, ids).Scan(&stored); err != nil {
		t.Fatalf("count surviving accounts: %v", err)
	}
	if stored != 0 {
		t.Fatalf("%d accounts survived a failed batch, want 0", stored)
	}
	var interests int
	if err := discovery.QueryRow(ctx, `SELECT count(*) FROM discovery_attendee_interests WHERE attendee_id = ANY($1)`, ids).Scan(&interests); err != nil {
		t.Fatalf("count surviving interest rows: %v", err)
	}
	if interests != 0 {
		t.Fatalf("%d interest rows survived a failed batch, want 0", interests)
	}
}

// TestARerunRepairsAccountsWithoutInterests covers the one state two databases
// can leave behind: accounts stored before their interests landed. The rerun
// must write the missing rows instead of skipping the accounts it recognises.
func TestARerunRepairsAccountsWithoutInterests(t *testing.T) {
	identity := startIdentityDatabase(t)
	discovery := startDiscoveryDatabase(t)
	ctx := context.Background()

	now := time.Now().UTC()
	batch := generateAttendees(attendeeSeed, attendeeOffsetRepair, 5, now, attendeePassword)
	ids := attendeeIDs(batch)
	cleanupAttendees(t, identity, discovery, ids)

	// Simulate a run that failed between the two databases.
	if written := insertAccounts(t, identity, batch); written != int64(len(batch)) {
		t.Fatalf("inserted %d accounts, want %d", written, len(batch))
	}
	var orphaned int
	if err := discovery.QueryRow(ctx, `SELECT count(*) FROM discovery_attendee_interests WHERE attendee_id = ANY($1)`, ids).Scan(&orphaned); err != nil {
		t.Fatalf("count interest rows: %v", err)
	}
	if orphaned != 0 {
		t.Fatalf("interest rows exist before the repair, want 0")
	}

	if written := insertAccounts(t, identity, batch); written != 0 {
		t.Fatalf("repair run inserted %d accounts, want 0", written)
	}
	if changed := upsertInterests(t, discovery, batch); changed != int64(len(batch)) {
		t.Fatalf("repair run wrote %d interest rows, want %d", changed, len(batch))
	}

	stored := storedInterests(t, discovery, ids)
	if len(stored) != len(batch) {
		t.Fatalf("after repair, stored %d interest rows, want %d", len(stored), len(batch))
	}
}

func generateAttendees(seed int64, offset, count int, now time.Time, password string) []attendeeseed.Attendee {
	batch := make([]attendeeseed.Attendee, 0, count)
	for index := offset; index < offset+count; index++ {
		batch = append(batch, attendeeseed.Generate(seed, index, now, password))
	}
	return batch
}

func attendeeIDs(batch []attendeeseed.Attendee) []uuid.UUID {
	ids := make([]uuid.UUID, 0, len(batch))
	for _, attendee := range batch {
		ids = append(ids, attendee.ID)
	}
	return ids
}

func insertAccounts(t *testing.T, pool *pgxpool.Pool, batch []attendeeseed.Attendee) int64 {
	t.Helper()
	ctx := context.Background()

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	written, err := attendeeseed.InsertAccounts(ctx, tx, batch)
	if err != nil {
		_ = tx.Rollback(ctx)
		t.Fatalf("insert accounts: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}
	return written
}

func upsertInterests(t *testing.T, pool *pgxpool.Pool, batch []attendeeseed.Attendee) int64 {
	t.Helper()
	ctx := context.Background()

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	changed, err := attendeeseed.UpsertInterests(ctx, tx, batch)
	if err != nil {
		_ = tx.Rollback(ctx)
		t.Fatalf("upsert interests: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}
	return changed
}

func storedInterests(t *testing.T, pool *pgxpool.Pool, ids []uuid.UUID) map[uuid.UUID][]string {
	t.Helper()
	ctx := context.Background()

	rows, err := pool.Query(ctx, `SELECT attendee_id, interests FROM discovery_attendee_interests WHERE attendee_id = ANY($1)`, ids)
	if err != nil {
		t.Fatalf("read interests: %v", err)
	}
	defer rows.Close()

	stored := make(map[uuid.UUID][]string, len(ids))
	for rows.Next() {
		var (
			attendeeID uuid.UUID
			interests  []string
		)
		if err := rows.Scan(&attendeeID, &interests); err != nil {
			t.Fatalf("scan interests: %v", err)
		}
		stored[attendeeID] = interests
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate interests: %v", err)
	}
	return stored
}

// stringsOf renders one interest list in a comparable order.
func stringsOf(values []string) string {
	sorted := append([]string(nil), values...)
	sort.Strings(sorted)
	joined := ""
	for _, value := range sorted {
		joined += value + "|"
	}
	return joined
}

// cleanupAttendees removes everything the attendee tests created across both
// databases, and fails the test if any row it created outlives the run.
func cleanupAttendees(t *testing.T, identity, discovery *pgxpool.Pool, ids []uuid.UUID) {
	t.Helper()
	ctx := context.Background()

	t.Cleanup(func() {
		if _, err := discovery.Exec(ctx, `DELETE FROM discovery_attendee_interests WHERE attendee_id = ANY($1)`, ids); err != nil {
			t.Errorf("clean up interest rows: %v", err)
		}
		if _, err := identity.Exec(ctx, `DELETE FROM attendee_accounts WHERE id = ANY($1)`, ids); err != nil {
			t.Errorf("clean up accounts: %v", err)
		}

		var remaining int
		if err := identity.QueryRow(ctx, `SELECT count(*) FROM attendee_accounts WHERE id = ANY($1)`, ids).Scan(&remaining); err != nil {
			t.Errorf("count remaining accounts: %v", err)
			return
		}
		if remaining != 0 {
			t.Errorf("%d seeded accounts were not removed", remaining)
		}
	})
}
