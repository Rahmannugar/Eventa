package main

import (
	"context"
	"os"
	"sort"
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
	entries, err := os.ReadDir(migrationDir)
	if err != nil {
		panic(err)
	}
	files := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".sql") {
			files = append(files, entry.Name())
		}
	}
	sort.Strings(files)
	for _, file := range files {
		contents, err := os.ReadFile(migrationDir + "/" + file)
		if err != nil {
			panic(err)
		}
		parts := strings.SplitN(string(contents), "---- create above / drop below ----", 2)
		down := ""
		if len(parts) == 2 {
			down = parts[1]
		}
		migrator.AppendMigration(file, parts[0], down)
	}
	if err := migrator.Migrate(ctx); err != nil {
		_, _ = os.Stderr.WriteString(err.Error() + "\n")
		os.Exit(1)
	}
}
