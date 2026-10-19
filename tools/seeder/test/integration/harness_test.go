package integration

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/eventa/tools/seeder/internal/eventseed"
)

var databaseName = regexp.MustCompile(`^[a-z][a-z0-9_]*_test$`)

// startEventDatabase connects to a disposable Event Service schema, and
// startIdentityDatabase and startDiscoveryDatabase do the same for the two
// databases the attendee seed writes. Each creates the database when it is
// missing and, when its service schema is not there yet, applies that
// service's own committed migrations, so every inserted row faces exactly the
// constraints production has. Any database that is not obviously disposable
// is refused.
func startEventDatabase(t *testing.T) *pgxpool.Pool {
	t.Helper()
	return startDatabase(t, "TEST_DATABASE_URL", "events", applyEventMigrations)
}

func startIdentityDatabase(t *testing.T) *pgxpool.Pool {
	t.Helper()
	return startDatabase(t, "TEST_IDENTITY_DATABASE_URL", "attendee_accounts", applyIdentityMigrations)
}

func startDiscoveryDatabase(t *testing.T) *pgxpool.Pool {
	t.Helper()
	return startDatabase(t, "TEST_DISCOVERY_DATABASE_URL", "discovery_event_index", applyDiscoveryMigrations)
}

func startDatabase(t *testing.T, env, marker string, migrate func(*testing.T, *pgxpool.Pool)) *pgxpool.Pool {
	t.Helper()

	if testing.Short() {
		t.Skip("integration tests are skipped in -short mode")
	}

	dsn := os.Getenv(env)
	if dsn == "" {
		t.Skip(env + " is not set")
	}

	config, err := pgx.ParseConfig(dsn)
	if err != nil {
		t.Fatalf("parse %s: %v", env, err)
	}
	if !databaseName.MatchString(config.Database) {
		t.Fatalf("%s database %q must match %s", env, config.Database, databaseName.String())
	}

	createTestDatabase(t, dsn, config.Database)

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(ctx); err != nil {
		t.Fatalf("ping: %v", err)
	}

	ensureSchema(t, pool, marker, migrate)
	return pool
}

func createTestDatabase(t *testing.T, dsn, name string) {
	t.Helper()

	config, err := pgx.ParseConfig(dsn)
	if err != nil {
		t.Fatalf("parse test database URL: %v", err)
	}
	config.Database = "postgres"

	ctx := context.Background()
	connection, err := pgx.ConnectConfig(ctx, config)
	if err != nil {
		t.Fatalf("connect to postgres database: %v", err)
	}
	defer func() { _ = connection.Close(ctx) }()

	_, err = connection.Exec(ctx, "CREATE DATABASE "+pgx.Identifier{name}.Sanitize())
	if err == nil {
		return
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "42P04" {
		return
	}
	t.Fatalf("create test database: %v", err)
}

// ensureSchema migrates only when the service's marker table is absent, so an
// existing schema is reused and never rebuilt underneath another test.
func ensureSchema(t *testing.T, pool *pgxpool.Pool, marker string, migrate func(*testing.T, *pgxpool.Pool)) {
	t.Helper()
	ctx := context.Background()

	var existing *string
	if err := pool.QueryRow(ctx, `SELECT to_regclass($1)::text`, "public."+marker).Scan(&existing); err != nil {
		t.Fatalf("inspect schema: %v", err)
	}
	if existing != nil {
		return
	}
	migrate(t, pool)
}

func applyEventMigrations(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	applyDrizzleMigrations(t, pool, serviceDirectory("event-service", "drizzle"))
}

func applyIdentityMigrations(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	applyDrizzleMigrations(t, pool, serviceDirectory("identity-service", "drizzle"))
}

func applyDiscoveryMigrations(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	applyTernMigrations(t, pool, serviceDirectory("discovery-service", "migrations"))
}

// applyDrizzleMigrations follows the service's journal: each entry names one
// SQL file, and each file is split on the breakpoint Drizzle writes between
// statements.
func applyDrizzleMigrations(t *testing.T, pool *pgxpool.Pool, directory string) {
	t.Helper()
	ctx := context.Background()

	journalJSON, err := os.ReadFile(filepath.Join(directory, "meta", "_journal.json"))
	if err != nil {
		t.Fatalf("read migration journal: %v", err)
	}
	var journal struct {
		Entries []struct {
			Tag         string `json:"tag"`
			Breakpoints bool   `json:"breakpoints"`
		} `json:"entries"`
	}
	if err := json.Unmarshal(journalJSON, &journal); err != nil {
		t.Fatalf("parse migration journal: %v", err)
	}
	if len(journal.Entries) == 0 {
		t.Fatalf("migration journal in %s lists no migrations", directory)
	}

	for _, entry := range journal.Entries {
		script, err := os.ReadFile(filepath.Join(directory, entry.Tag+".sql"))
		if err != nil {
			t.Fatalf("read migration %s: %v", entry.Tag, err)
		}
		statements := []string{string(script)}
		if entry.Breakpoints {
			statements = strings.Split(string(script), "--> statement-breakpoint")
		}
		for _, statement := range statements {
			statement = strings.TrimSpace(statement)
			if statement == "" {
				continue
			}
			if _, err := pool.Exec(ctx, statement); err != nil {
				t.Fatalf("apply migration %s: %v", entry.Tag, err)
			}
		}
	}
}

// applyTernMigrations runs each committed Tern script in order. Only the "up"
// half of a script is applied, split on semicolons the way Tern itself
// sequences the statements.
func applyTernMigrations(t *testing.T, pool *pgxpool.Pool, directory string) {
	t.Helper()
	ctx := context.Background()

	scripts, err := filepath.Glob(filepath.Join(directory, "*.sql"))
	if err != nil {
		t.Fatalf("list migrations: %v", err)
	}
	sort.Strings(scripts)
	if len(scripts) == 0 {
		t.Fatalf("no migrations found in %s", directory)
	}

	for _, script := range scripts {
		contents, err := os.ReadFile(script)
		if err != nil {
			t.Fatalf("read migration %s: %v", filepath.Base(script), err)
		}
		up := string(contents)
		if parts := strings.SplitN(up, "---- create above / drop below ----", 2); len(parts) > 0 {
			up = parts[0]
		}
		for _, statement := range strings.Split(up, ";") {
			statement = strings.TrimSpace(statement)
			if statement == "" {
				continue
			}
			if _, err := pool.Exec(ctx, statement); err != nil {
				t.Fatalf("apply migration %s: %v", filepath.Base(script), err)
			}
		}
	}
}

// serviceDirectory points at a sibling service's files from the seeder's test
// package: the seeder owns no schema of its own, it writes service schemas.
func serviceDirectory(parts ...string) string {
	return filepath.Join(append([]string{"..", "..", "..", "..", "services"}, parts...)...)
}

func generateBatch(seed int64, offset, count int, now time.Time, adminID uuid.UUID) []eventseed.Event {
	events := make([]eventseed.Event, 0, count)
	for index := offset; index < offset+count; index++ {
		events = append(events, eventseed.Generate(seed, index, now, adminID))
	}
	return events
}

func eventIDs(events []eventseed.Event) []uuid.UUID {
	ids := make([]uuid.UUID, 0, len(events))
	for _, event := range events {
		ids = append(ids, event.ID)
	}
	return ids
}

// insertBatch commits one batch through the same transactional path the tool
// uses, so a test failure leaves the reason visible.
func insertBatch(t *testing.T, pool *pgxpool.Pool, events []eventseed.Event) int64 {
	t.Helper()
	ctx := context.Background()

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	written, err := eventseed.InsertBatch(ctx, tx, events)
	if err != nil {
		_ = tx.Rollback(ctx)
		t.Fatalf("insert batch: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}
	return written
}

// removeEvents deletes everything the event tests created, in foreign-key
// order, and fails the test if any row it created outlives the run.
func removeEvents(t *testing.T, pool *pgxpool.Pool, ids []uuid.UUID) {
	t.Helper()
	ctx := context.Background()

	for _, statement := range []string{
		`DELETE FROM event_publication_outbox WHERE event_id = ANY($1)`,
		`DELETE FROM event_ticket_types WHERE ticket_currency_id IN (SELECT id FROM event_ticket_currencies WHERE event_id = ANY($1))`,
		`DELETE FROM event_ticket_currencies WHERE event_id = ANY($1)`,
		`DELETE FROM event_categories WHERE event_id = ANY($1)`,
		`DELETE FROM event_venues WHERE event_id = ANY($1)`,
		`DELETE FROM events WHERE id = ANY($1)`,
	} {
		if _, err := pool.Exec(ctx, statement, ids); err != nil {
			t.Errorf("clean up seeded rows: %v", err)
			return
		}
	}

	var remaining int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM events WHERE id = ANY($1)`, ids).Scan(&remaining); err != nil {
		t.Errorf("count remaining seeded events: %v", err)
		return
	}
	if remaining != 0 {
		t.Errorf("%d seeded events were not removed", remaining)
	}
}

func decodeFact(payload []byte) (eventseed.PublishedPayload, error) {
	var fact eventseed.PublishedPayload
	err := json.Unmarshal(payload, &fact)
	return fact, err
}
