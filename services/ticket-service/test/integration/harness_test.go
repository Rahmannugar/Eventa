package integration

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/tern/v2/migrate"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
)

func startMigratedPostgres(t *testing.T) *pgxpool.Pool {
	t.Helper()
	if testing.Short() {
		t.Skip("integration tests require Docker and are skipped in -short mode")
	}
	ctx := context.Background()
	container, err := postgres.Run(ctx, "postgres:17-alpine",
		postgres.WithDatabase("eventa_ticket_test"),
		postgres.WithUsername("eventa_ticket"),
		postgres.WithPassword("eventa_ticket"),
		testcontainers.WithWaitStrategy(waitForPostgres()),
	)
	if err != nil {
		t.Fatalf("start postgres: %v", err)
	}
	t.Cleanup(func() {
		_ = testcontainers.TerminateContainer(container)
	})
	dsn, err := container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("connection string: %v", err)
	}
	applyMigrations(t, ctx, dsn)
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(ctx); err != nil {
		t.Fatalf("ping: %v", err)
	}
	return pool
}

func waitForPostgres() wait.Strategy {
	return wait.ForListeningPort("5432").
		WithStartupTimeout(60 * time.Second).
		WithPollInterval(500 * time.Millisecond)
}

func applyMigrations(t *testing.T, ctx context.Context, dsn string) {
	t.Helper()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatalf("connect for migration: %v", err)
	}
	defer func() { _ = conn.Close(ctx) }()
	migrator, err := migrate.NewMigrator(ctx, conn, "ticket_schema_version")
	if err != nil {
		t.Fatalf("migrator: %v", err)
	}
	dir := filepath.Join("..", "..", "migrations")
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read migrations: %v", err)
	}
	files := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".sql") {
			files = append(files, entry.Name())
		}
	}
	sort.Strings(files)
	for _, file := range files {
		contents, err := os.ReadFile(filepath.Join(dir, file))
		if err != nil {
			t.Fatalf("read %s: %v", file, err)
		}
		parts := strings.SplitN(string(contents), "---- create above / drop below ----", 2)
		down := ""
		if len(parts) == 2 {
			down = parts[1]
		}
		migrator.AppendMigration(file, parts[0], down)
	}
	if err := migrator.Migrate(ctx); err != nil {
		t.Fatalf("migrate: %v", err)
	}
}
