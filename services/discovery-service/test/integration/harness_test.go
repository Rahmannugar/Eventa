package integration

import (
	"context"
	"errors"
	"os"
	"regexp"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/eventa/discovery-service/internal/database"
)

var databaseName = regexp.MustCompile(`^[a-z][a-z0-9_]*_test$`)

// startMigratedDatabase connects to the service's test database, creating it
// and applying the reviewed migrations when needed. It refuses any database
// name that is not obviously disposable.
func startMigratedDatabase(t *testing.T) *pgxpool.Pool {
	t.Helper()

	if testing.Short() {
		t.Skip("integration tests are skipped in -short mode")
	}

	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}

	config, err := pgx.ParseConfig(dsn)
	if err != nil {
		t.Fatalf("parse TEST_DATABASE_URL: %v", err)
	}
	if !databaseName.MatchString(config.Database) {
		t.Fatalf("TEST_DATABASE_URL database %q must match %s", config.Database, databaseName.String())
	}

	createTestDatabase(t, dsn, config.Database)

	if err := database.Migrate(context.Background(), dsn, migrationsDir()); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)

	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	return pool
}

func createTestDatabase(t *testing.T, dsn, name string) {
	t.Helper()

	config, err := pgx.ParseConfig(dsn)
	if err != nil {
		t.Fatalf("parse TEST_DATABASE_URL: %v", err)
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

func migrationsDir() string {
	return "../../migrations"
}

func resetIndex(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	const tables = "TRUNCATE discovery_event_index, discovery_event_inbox, discovery_semantic_index"
	if _, err := pool.Exec(context.Background(), tables); err != nil {
		t.Fatalf("truncate index tables: %v", err)
	}
}
