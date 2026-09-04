package main

import (
	"context"
	"os"
	"strings"

	"github.com/eventa/ticket-service/internal/config"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/tern/v2/migrate"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		panic(err)
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		panic(err)
	}
	defer conn.Close(ctx)
	migrator, err := migrate.NewMigrator(ctx, conn, "ticket_schema_version")
	if err != nil {
		panic(err)
	}
	migrationDir := os.Getenv("MIGRATIONS_DIR")
	if migrationDir == "" {
		migrationDir = "migrations"
	}
	contents, err := os.ReadFile(migrationDir + "/001_create_ticket_issuance.sql")
	if err != nil {
		panic(err)
	}
	parts := strings.SplitN(string(contents), "---- create above / drop below ----", 2)
	migrator.AppendMigration("001_create_ticket_issuance.sql", parts[0], parts[1])
	if err := migrator.Migrate(ctx); err != nil {
		_, _ = os.Stderr.WriteString(err.Error() + "\n")
		os.Exit(1)
	}
}
