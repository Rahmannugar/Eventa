package database

import (
	"context"
	"fmt"
	"os"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/tern/v2/migrate"
)

// Migrate applies every reviewed SQL migration in directory to databaseURL.
// The tern journal keeps the applied filenames, so re-running is a no-op.
func Migrate(ctx context.Context, databaseURL, directory string) error {
	conn, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		return fmt.Errorf("connect for migration: %w", err)
	}
	defer func() { _ = conn.Close(ctx) }()

	migrator, err := migrate.NewMigrator(ctx, conn, "notification_schema_version")
	if err != nil {
		return fmt.Errorf("create migrator: %w", err)
	}

	entries, err := os.ReadDir(directory)
	if err != nil {
		return fmt.Errorf("read migrations: %w", err)
	}

	files := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".sql") {
			files = append(files, entry.Name())
		}
	}
	sort.Strings(files)

	for _, file := range files {
		contents, err := os.ReadFile(directory + "/" + file)
		if err != nil {
			return fmt.Errorf("read %s: %w", file, err)
		}
		parts := strings.SplitN(string(contents), "---- create above / drop below ----", 2)
		down := ""
		if len(parts) == 2 {
			down = parts[1]
		}
		migrator.AppendMigration(file, parts[0], down)
	}

	if err := migrator.Migrate(ctx); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	return nil
}
